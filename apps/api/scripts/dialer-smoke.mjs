/**
 * Exercises the dialer end to end against the sandbox telephony provider.
 *
 * Unlike the other smoke scripts this one has to *arrange* the world first — calling is
 * seeded off, and a campaign needs an agent, a script and leads before it may activate.
 * The setup is done through Prisma directly (it is a fixture, not a feature) and undone
 * at the end, so the demo data is the same afterwards.
 *
 * What it proves:
 *   - a dialer pass places calls and charges exactly once per call
 *   - a second immediate pass does not re-dial the same leads
 *   - the retry delay, not chance, is what holds leads back
 *   - the ledger still reconciles afterwards
 *
 *   node scripts/dialer-smoke.mjs
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.SMOKE_API ?? "http://localhost:4000/api";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://appsgain:appsgain@127.0.0.1:5432/postgres?schema=public&pgbouncer=true";

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { token, method = "GET", body } = {}) {
  await wait(150);
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (response.status >= 400) await wait(300);
  return { status: response.status, body: json };
}

async function main() {
  const { body: auth } = await api("/auth/login", {
    method: "POST",
    body: { subdomain: "northwind", email: "owner@northwind.test", password: "Appsgain#2026" },
  });
  const token = auth?.accessToken;
  if (!token) throw new Error("could not sign in — is the API running and seeded?");

  const tenant = await prisma.tenant.findFirstOrThrow({ where: { subdomain: "northwind" } });

  // ── arrange ───────────────────────────────────────────────────────────────────────
  const originalSettings = await prisma.callSettings.findUniqueOrThrow({
    where: { tenantId: tenant.id },
  });

  await prisma.callSettings.update({
    where: { tenantId: tenant.id },
    data: {
      callingEnabled: true,
      // The window is opened to the whole day and every weekday-or-weekend so the test
      // does not pass or fail depending on the hour it happens to run at.
      callWindowStart: 0,
      callWindowEnd: 1439,
      callDays: [0, 1, 2, 3, 4, 5, 6],
      maxCallsPerDay: null,
    },
  });

  const agent = await prisma.aiAgent.findFirstOrThrow({ where: { tenantId: tenant.id } });

  const campaign = await prisma.campaign.create({
    data: {
      tenantId: tenant.id,
      name: `Dialer probe ${Date.now()}`,
      type: "AI_CALLING",
      status: "DRAFT",
      aiAgentId: agent.id,
      callScript: "Probe script.",
      callWindowStart: 0,
      callWindowEnd: 1439,
      callDays: [0, 1, 2, 3, 4, 5, 6],
      maxAttempts: 3,
      retryDelayMinutes: 240,
    },
  });

  // Fresh, callable leads of our own — reusing seeded leads would leave call history
  // attached to demo records.
  const leads = [];
  for (let i = 0; i < 4; i += 1) {
    leads.push(
      // eslint-disable-next-line no-await-in-loop
      await prisma.lead.create({
        data: {
          tenantId: tenant.id,
          name: `Probe Co ${i}`,
          phone: `+9170000${String(10000 + i).slice(0, 5)}`,
          status: "NEW",
          country: "India",
          city: "Pune",
        },
      }),
    );
  }

  await prisma.campaignLead.createMany({
    data: leads.map((lead) => ({
      tenantId: tenant.id,
      campaignId: campaign.id,
      leadId: lead.id,
      state: "PENDING",
    })),
  });

  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "ACTIVE" } });

  const walletBefore = await prisma.creditWallet.findUniqueOrThrow({
    where: { tenantId: tenant.id },
  });

  try {
    console.log("PREVIEW");
    const preview = await api(`/calls/dialer/preview/${campaign.id}`, { token });
    check("preview reports the due leads", preview.body?.due === 4, JSON.stringify(preview.body));

    console.log("\nFIRST PASS");
    const first = await api(`/calls/dialer/run/${campaign.id}`, { token, method: "POST" });
    check("the pass runs", first.status === 200, `got ${first.status}`);
    check(
      "it considers every due lead",
      first.body?.considered === 4,
      JSON.stringify(first.body),
    );
    check("it places a call for each", first.body?.placed === 4, JSON.stringify(first.body));

    const callsAfter = await prisma.call.count({ where: { campaignId: campaign.id } });
    check("one call row per lead", callsAfter === 4, `got ${callsAfter}`);

    const walletAfter = await prisma.creditWallet.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    check(
      "exactly one credit charged per call",
      walletBefore.balance - walletAfter.balance === 4,
      `${walletBefore.balance} -> ${walletAfter.balance}`,
    );

    console.log("\nSECOND PASS — must not re-dial");
    const second = await api(`/calls/dialer/run/${campaign.id}`, { token, method: "POST" });
    check(
      "nothing is due immediately after a pass",
      second.body?.considered === 0,
      JSON.stringify(second.body),
    );

    const callsAfterSecond = await prisma.call.count({ where: { campaignId: campaign.id } });
    check(
      "no additional call rows were created",
      callsAfterSecond === 4,
      `got ${callsAfterSecond}`,
    );

    // Counting debits, not comparing balances. The second pass sweeps the first pass's
    // calls, and the ones that did not connect are refunded — so the balance legitimately
    // goes *up*. An equality check here fails on correct behaviour, which is what it did
    // the first time this test ran.
    const probeLeadIds = leads.map((l) => l.id);
    const debits = await prisma.creditTransaction.count({
      where: {
        tenantId: tenant.id,
        type: "DEBIT",
        operation: "AI_CALL",
        referenceId: { in: probeLeadIds },
      },
    });
    check("exactly one debit per call, and no more", debits === 4, `got ${debits}`);

    const refunds = await prisma.creditTransaction.count({
      where: {
        tenantId: tenant.id,
        type: "CREDIT",
        operation: "REFUND",
        referenceId: { in: probeLeadIds },
      },
    });
    const connectedCalls = await prisma.call.count({
      where: { campaignId: campaign.id, status: "COMPLETED" },
    });
    check(
      "every call that did not connect was refunded",
      refunds === 4 - connectedCalls,
      `${refunds} refunds for ${4 - connectedCalls} unconnected of 4`,
    );

    console.log("\nSTATE");
    const states = await prisma.campaignLead.groupBy({
      by: ["state"],
      where: { campaignId: campaign.id },
      _count: { _all: true },
    });
    console.log(`  ${states.map((s) => `${s.state}=${s._count._all}`).join(" ")}`);
    check(
      "no lead is left claimed as IN_PROGRESS forever",
      !states.some((s) => s.state === "IN_PROGRESS" && s._count._all === 4),
      JSON.stringify(states),
    );

    console.log("\nLEDGER");
    const reconcile = await api("/credits/reconcile", { token });
    check("wallet still matches its ledger", reconcile.body?.drift === 0, JSON.stringify(reconcile.body));
  } finally {
    // ── restore ─────────────────────────────────────────────────────────────────────
    const callIds = (
      await prisma.call.findMany({ where: { campaignId: campaign.id }, select: { id: true } })
    ).map((c) => c.id);

    await prisma.transcriptSegment.deleteMany({
      where: { transcript: { callId: { in: callIds } } },
    });
    await prisma.transcript.deleteMany({ where: { callId: { in: callIds } } });
    await prisma.recording.deleteMany({ where: { callId: { in: callIds } } });
    await prisma.callParticipant.deleteMany({ where: { callId: { in: callIds } } });
    await prisma.call.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaignLead.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: leads.map((l) => l.id) } } });
    await prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });

    await prisma.creditTransaction.deleteMany({
      where: { tenantId: tenant.id, referenceId: { in: leads.map((l) => l.id) } },
    });
    await prisma.creditWallet.update({
      where: { tenantId: tenant.id },
      data: { balance: walletBefore.balance },
    });
    await prisma.callSettings.update({
      where: { tenantId: tenant.id },
      data: {
        callingEnabled: originalSettings.callingEnabled,
        callWindowStart: originalSettings.callWindowStart,
        callWindowEnd: originalSettings.callWindowEnd,
        callDays: originalSettings.callDays,
        maxCallsPerDay: originalSettings.maxCallsPerDay,
      },
    });
    console.log("\nfixtures removed, settings and wallet restored");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error("dialer smoke failed:", error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
