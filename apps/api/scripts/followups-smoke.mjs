/**
 * Drives Follow-ups against the running API.
 *
 * The claims worth checking are the ones the module decides for itself: that "today" and
 * "overdue" are read off the clock rather than stored, that the three open states
 * partition the queue so the filter counts reconcile, that completing is idempotent
 * enough to survive two people clicking at once, and that a viewer cannot change anything.
 *
 *   node scripts/followups-smoke.mjs
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

const inDays = (days, hour = 11) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

async function main() {
  const owner = await login("northwind", "owner@northwind.test");
  const agent = await login("northwind", "agent@northwind.test");
  const viewer = await login("northwind", "viewer@northwind.test");
  const outsider = await login("cobalt", "owner@cobalt.test");
  if (!owner) throw new Error("could not sign in — is the API running and seeded?");

  const leads = await api("/leads?pageSize=1", { token: owner });
  const leadId = leads.body?.data?.[0]?.id;
  if (!leadId) throw new Error("no leads in the seed — run `npm run db:seed`");

  const members = await api("/users?status=ACTIVE", { token: owner });
  check("the member list is readable", members.status === 200 && members.body.length > 0);
  check(
    "and never carries a password hash",
    members.body.every((m) => !("passwordHash" in m)),
  );

  console.log("\nLISTING AND DERIVED STATE");
  const all = await api("/follow-ups?pageSize=10", { token: owner });
  check("follow-ups list returns a page", all.status === 200 && Array.isArray(all.body?.data));
  check(
    "every row carries a derived status",
    all.body.data.every((f) =>
      ["PENDING", "TODAY", "OVERDUE", "COMPLETED", "CANCELLED"].includes(f.derivedStatus),
    ),
  );
  check(
    "the derived status never contradicts the stored one",
    all.body.data.every((f) =>
      f.status === "PENDING"
        ? ["PENDING", "TODAY", "OVERDUE"].includes(f.derivedStatus)
        : f.derivedStatus === f.status,
    ),
  );
  check(
    "due dates come back ascending by default",
    all.body.data.every(
      (f, i) => i === 0 || Date.parse(all.body.data[i - 1].dueAt) <= Date.parse(f.dueAt),
    ),
  );

  const overdue = await api("/follow-ups?status=OVERDUE&pageSize=100", { token: owner });
  check(
    "an overdue filter returns only pending rows in the past",
    overdue.body.data.every((f) => f.status === "PENDING" && Date.parse(f.dueAt) < Date.now()),
  );
  check(
    "and every one of them is labelled overdue",
    overdue.body.data.every((f) => f.derivedStatus === "OVERDUE"),
  );

  const today = await api("/follow-ups?status=TODAY&pageSize=100", { token: owner });
  check(
    "a today filter returns only rows labelled today",
    today.body.data.every((f) => f.derivedStatus === "TODAY"),
  );

  const upcoming = await api("/follow-ups?status=PENDING&pageSize=100", { token: owner });
  check(
    "an upcoming filter excludes today and overdue",
    upcoming.body.data.every((f) => f.derivedStatus === "PENDING"),
  );

  console.log("\nSTATS RECONCILE");
  const stats = await api("/follow-ups/stats", { token: owner });
  check("stats totals are numbers", typeof stats.body?.total === "number");
  check(
    "stats total agrees with the unfiltered list",
    stats.body.total === all.body.total,
    `stats ${stats.body?.total} vs list ${all.body?.total}`,
  );
  check(
    "pending = overdue + today + upcoming, with no double counting",
    stats.body.pending === stats.body.overdue + stats.body.today + upcoming.body.total,
    `pending ${stats.body.pending} vs ${stats.body.overdue}+${stats.body.today}+${upcoming.body.total}`,
  );
  check(
    "total = pending + completed + cancelled",
    stats.body.total === stats.body.pending + stats.body.completed + stats.body.cancelled,
  );
  check(
    "the overdue count matches the overdue filter",
    stats.body.overdue === overdue.body.total,
    `${stats.body.overdue} vs ${overdue.body.total}`,
  );

  console.log("\nDUE WINDOWS");
  const dueToday = await api("/follow-ups?dueWithin=today&pageSize=100", { token: owner });
  const dueTomorrow = await api("/follow-ups?dueWithin=tomorrow&pageSize=100", { token: owner });
  const overlap = dueToday.body.data.filter((f) =>
    dueTomorrow.body.data.some((g) => g.id === f.id),
  );
  check("today and tomorrow never return the same row", overlap.length === 0);

  const past = await api("/follow-ups?dueWithin=past&pageSize=100", { token: owner });
  check(
    "the past window holds nothing due today or later",
    past.body.data.every((f) => Date.parse(f.dueAt) < Date.now()),
  );

  console.log("\nBOOKING");
  const created = await api("/follow-ups", {
    token: agent,
    method: "POST",
    body: {
      leadId,
      dueAt: inDays(3),
      channel: "WHATSAPP",
      priority: "HIGH",
      notes: "Smoke test follow-up.",
      remindAt: new Date(Date.parse(inDays(3)) - 30 * 60_000).toISOString(),
    },
  });
  check("an agent can book a follow-up", created.status === 201, JSON.stringify(created.body));
  const id = created.body?.id;
  check("a hand-booked follow-up is not marked AI-generated", created.body?.isAiGenerated === false);
  check("it is assigned to someone rather than nobody", Boolean(created.body?.assigneeId));

  const timeline = await api(`/leads/${leadId}/activity`, { token: owner });
  check(
    "booking one lands on the lead's timeline",
    Array.isArray(timeline.body) && timeline.body.some((a) => a.type === "FOLLOWUP_CREATED"),
  );

  const backwards = await api("/follow-ups", {
    token: agent,
    method: "POST",
    body: { leadId, dueAt: inDays(3), remindAt: inDays(4) },
  });
  check(
    "a reminder after the due date is refused",
    backwards.status === 400,
    `got ${backwards.status}`,
  );

  const badLead = await api("/follow-ups", {
    token: agent,
    method: "POST",
    body: { leadId: "00000000-0000-0000-0000-000000000000", dueAt: inDays(1) },
  });
  check("a follow-up against a missing lead is refused with 404", badLead.status === 404);

  const derivedWrite = await api(`/follow-ups/${id}`, {
    token: agent,
    method: "PATCH",
    body: { status: "OVERDUE" },
  });
  check(
    "a derived status cannot be written",
    derivedWrite.status === 400,
    `got ${derivedWrite.status}`,
  );

  console.log("\nRESCHEDULING AND COMPLETING");
  const rescheduled = await api(`/follow-ups/${id}`, {
    token: agent,
    method: "PATCH",
    body: { dueAt: inDays(5) },
  });
  check("a follow-up can be rescheduled", rescheduled.status === 200);
  check(
    "rescheduling clears the sent-reminder mark so the new time still alerts",
    rescheduled.body?.reminderSentAt === null,
  );

  const done = await api(`/follow-ups/${id}`, {
    token: agent,
    method: "PATCH",
    body: { status: "COMPLETED" },
  });
  check("it can be completed", done.status === 200 && done.body.status === "COMPLETED");
  check("completing stamps completedAt", Boolean(done.body?.completedAt));

  const fetched = await api(`/follow-ups/${id}`, { token: owner });
  check(
    "a completed follow-up is never re-labelled overdue, however old its due date",
    fetched.body?.derivedStatus === "COMPLETED",
  );

  const reopened = await api(`/follow-ups/${id}`, {
    token: agent,
    method: "PATCH",
    body: { status: "PENDING" },
  });
  check("it can be reopened", reopened.body?.status === "PENDING");
  check("reopening clears completedAt", reopened.body?.completedAt === null);

  console.log("\nBULK COMPLETE");
  const batch = [];
  for (let i = 0; i < 3; i += 1) {
    const row = await api("/follow-ups", {
      token: agent,
      method: "POST",
      body: { leadId, dueAt: inDays(6 + i), notes: `Bulk ${i}` },
    });
    batch.push(row.body.id);
  }

  const firstPass = await api("/follow-ups/complete", {
    token: agent,
    method: "POST",
    body: { ids: batch },
  });
  check("three at once complete three", firstPass.body?.completed === 3, JSON.stringify(firstPass.body));

  const secondPass = await api("/follow-ups/complete", {
    token: agent,
    method: "POST",
    body: { ids: batch },
  });
  check(
    "completing the same three again completes none — no re-stamping",
    secondPass.body?.completed === 0,
    JSON.stringify(secondPass.body),
  );

  const empty = await api("/follow-ups/complete", {
    token: agent,
    method: "POST",
    body: { ids: [] },
  });
  check("an empty bulk request is rejected rather than silently doing nothing", empty.status === 400);

  console.log("\nPERMISSIONS AND ISOLATION");
  if (viewer) {
    const viewerReads = await api("/follow-ups?pageSize=1", { token: viewer });
    check("a viewer can read the queue", viewerReads.status === 200);
    const viewerWrites = await api("/follow-ups", {
      token: viewer,
      method: "POST",
      body: { leadId, dueAt: inDays(2) },
    });
    check("a viewer cannot book one", viewerWrites.status === 403, `got ${viewerWrites.status}`);
    const viewerCompletes = await api(`/follow-ups/${id}`, {
      token: viewer,
      method: "PATCH",
      body: { status: "COMPLETED" },
    });
    check("nor complete one", viewerCompletes.status === 403);
    const viewerMembers = await api("/users", { token: viewer });
    check("but can see who is on the team", viewerMembers.status === 200);
  }

  if (outsider) {
    const crossRead = await api(`/follow-ups/${id}`, { token: outsider });
    check("another workspace cannot read this follow-up", crossRead.status === 404);
    const crossWrite = await api(`/follow-ups/${id}`, {
      token: outsider,
      method: "PATCH",
      body: { priority: "LOW" },
    });
    check("nor change it", crossWrite.status === 404);
    const crossComplete = await api("/follow-ups/complete", {
      token: outsider,
      method: "POST",
      body: { ids: [id] },
    });
    check(
      "nor complete it through the bulk route",
      crossComplete.body?.completed === 0,
      JSON.stringify(crossComplete.body),
    );
  }

  console.log("\nCLEAN-UP");
  for (const target of [id, ...batch]) {
    await api(`/follow-ups/${target}`, { token: owner, method: "DELETE" });
  }
  const gone = await api(`/follow-ups/${id}`, { token: owner });
  check("deleted follow-ups are gone", gone.status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
