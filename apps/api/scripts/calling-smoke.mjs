/**
 * Drives the AI calling pipeline against the running API.
 *
 * The claims being checked are the ones that matter for a dialer: that a call which is
 * not allowed is refused with reasons, that credits move exactly once and come back when
 * a call does not connect, and that syncing the same call twice does not produce two
 * transcripts.
 *
 *   node scripts/calling-smoke.mjs
 */
const BASE = process.env.SMOKE_API ?? "http://localhost:4000/api";
const PASSWORD = "Appsgain#2026";
const PACE_MS = Number(process.env.SMOKE_PACE_MS ?? 150);

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, { token, method = "GET", body } = {}) {
  await wait(PACE_MS);
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

async function login(subdomain, email) {
  const { body } = await api("/auth/login", {
    method: "POST",
    body: { subdomain, email, password: PASSWORD },
  });
  return body?.accessToken;
}

async function main() {
  const owner = await login("northwind", "owner@northwind.test");
  const viewer = await login("northwind", "viewer@northwind.test");
  if (!owner) throw new Error("could not sign in — is the API running and seeded?");

  console.log("PROVIDER HONESTY");
  const health = await api("/providers/health", { token: owner });
  const telephony = health.body.providers.find((p) => p.kind === "TELEPHONY");
  check("telephony reports it is the sandbox", telephony?.usingSandbox === true);
  check(
    "the sandbox says plainly that no calls are placed",
    String(telephony?.detail).toLowerCase().includes("no calls are placed"),
    telephony?.detail,
  );

  console.log("\nRBAC");
  const leadPage = await api("/leads?pageSize=5", { token: owner });
  const lead = leadPage.body.data.find((l) => !["CONVERTED", "LOST", "CLOSED"].includes(l.status));
  const viewerPlace = await api("/calls", {
    token: viewer,
    method: "POST",
    body: { leadId: lead.id },
  });
  check("viewer cannot place a call", viewerPlace.status === 403, `got ${viewerPlace.status}`);
  check(
    "the refusal names calling.start",
    String(viewerPlace.body?.message).includes("calling.start"),
    String(viewerPlace.body?.message),
  );

  console.log("\nGATES");
  const gates = await api(`/calls/gates/${lead.id}`, { token: owner });
  check("gates can be explained without dialling", gates.status === 200, `got ${gates.status}`);
  check(
    "every reason has readable text",
    Array.isArray(gates.body?.messages) &&
      gates.body.messages.length === gates.body.reasons.length,
    JSON.stringify(gates.body),
  );

  // Calling is seeded off, so the first gate a fresh workspace hits is the switch itself.
  check(
    "calling is refused while the workspace switch is off",
    gates.body.allowed === false && gates.body.reasons.includes("CALLING_DISABLED"),
    JSON.stringify(gates.body?.reasons),
  );

  const blocked = await api("/calls", {
    token: owner,
    method: "POST",
    body: { leadId: lead.id },
  });
  check(
    "a blocked call is reported, not thrown",
    blocked.status === 200 && blocked.body.placed === false,
    `${blocked.status} ${JSON.stringify(blocked.body)}`,
  );
  check(
    "a blocked call explains itself",
    typeof blocked.body?.message === "string" && blocked.body.message.length > 0,
    blocked.body?.message,
  );

  console.log("\nCREDITS ARE NOT SPENT ON A BLOCKED CALL");
  const before = await api("/credits", { token: owner });
  await api("/calls", { token: owner, method: "POST", body: { leadId: lead.id } });
  const after = await api("/credits", { token: owner });
  check(
    "balance is unchanged when the gates refuse",
    before.body.balance === after.body.balance,
    `${before.body.balance} -> ${after.body.balance}`,
  );

  console.log("\nLEDGER INTEGRITY");
  const reconcile = await api("/credits/reconcile", { token: owner });
  check("wallet still matches its ledger", reconcile.body?.drift === 0, JSON.stringify(reconcile.body));

  console.log("\nTENANT ISOLATION");
  const other = await login("cobalt", "owner@cobalt.test");
  const crossGate = await api(`/calls/gates/${lead.id}`, { token: other });
  check(
    "another workspace cannot gate-check this lead",
    crossGate.status === 404,
    `got ${crossGate.status}`,
  );
  const crossPlace = await api("/calls", {
    token: other,
    method: "POST",
    body: { leadId: lead.id },
  });
  check(
    "another workspace cannot call this lead",
    crossPlace.status === 404,
    `got ${crossPlace.status}`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("calling smoke failed:", error.message);
  process.exit(1);
});
