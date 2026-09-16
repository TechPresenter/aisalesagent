/**
 * Drives Sales Notes against the running API.
 *
 * The claims worth checking here are about authorship, because that is the only thing
 * this module gets to decide on its own: that a note the AI wrote stops being the AI's
 * the moment a person rewrites it, that a note a colleague wrote cannot be quietly
 * overwritten by someone without the authority to do so, that a viewer cannot write at
 * all, and that one workspace's notes are invisible to another.
 *
 *   node scripts/notes-smoke.mjs
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
  const agent = await login("northwind", "agent@northwind.test");
  const viewer = await login("northwind", "viewer@northwind.test");
  const outsider = await login("cobalt", "owner@cobalt.test");
  if (!owner) throw new Error("could not sign in — is the API running and seeded?");

  const leads = await api("/leads?pageSize=1", { token: owner });
  const leadId = leads.body?.data?.[0]?.id;
  if (!leadId) throw new Error("no leads in the seed — run `npm run db:seed`");

  console.log("LISTING AND FILTERS");
  const all = await api("/notes?pageSize=5", { token: owner });
  check("notes list returns a page", all.status === 200 && Array.isArray(all.body?.data));
  check(
    "page size is honoured",
    all.body?.data.length <= 5,
    `got ${all.body?.data?.length}`,
  );
  check(
    "every row carries its lead",
    all.body.data.every((n) => n.lead === null || typeof n.lead?.name === "string"),
  );
  check(
    "newest first",
    all.body.data.every(
      (n, i) => i === 0 || Date.parse(all.body.data[i - 1].createdAt) >= Date.parse(n.createdAt),
    ),
  );

  const aiOnly = await api("/notes?aiOnly=true&pageSize=20", { token: owner });
  check(
    "aiOnly=true returns only AI notes",
    aiOnly.body.data.length > 0 && aiOnly.body.data.every((n) => n.isAiGenerated === true),
  );
  const humanOnly = await api("/notes?aiOnly=false&pageSize=20", { token: owner });
  check(
    "aiOnly=false returns only human notes",
    humanOnly.body.data.every((n) => n.isAiGenerated === false),
  );

  const typed = await api("/notes?type=PRICING&pageSize=20", { token: owner });
  check(
    "type filter is applied server-side",
    typed.body.data.every((n) => n.type === "PRICING"),
  );

  const stats = await api("/notes/stats", { token: owner });
  check("stats totals are numbers", typeof stats.body?.total === "number");
  check(
    "stats total agrees with an unfiltered count",
    stats.body.total === all.body.total,
    `stats ${stats.body?.total} vs list ${all.body?.total}`,
  );
  check(
    "byType sums to the total",
    stats.body.byType.reduce((sum, row) => sum + row.count, 0) === stats.body.total,
  );

  console.log("\nSEARCH");
  const seeded = all.body.data[0];
  const term = seeded.content.split(/\s+/).find((w) => w.length > 5) ?? "call";
  const found = await api(`/notes?search=${encodeURIComponent(term)}&pageSize=20`, {
    token: owner,
  });
  check(
    `search for "${term}" matches on content`,
    found.body.data.some((n) => n.content.toLowerCase().includes(term.toLowerCase())),
  );

  console.log("\nWRITING");
  const created = await api("/notes", {
    token: agent,
    method: "POST",
    body: {
      leadId,
      title: "Smoke test note",
      content: "Wrote this from the notes smoke test.",
      type: "FOLLOW_UP",
      sentiment: "NEUTRAL",
    },
  });
  check("an agent can create a note", created.status === 201, JSON.stringify(created.body));
  const noteId = created.body?.id;
  check("a hand-written note is not marked AI-generated", created.body?.isAiGenerated === false);

  const timeline = await api(`/leads/${leadId}/activity`, { token: owner });
  check(
    "creating a note lands on the lead's timeline",
    Array.isArray(timeline.body) &&
      timeline.body.some((a) => a.type === "NOTE_ADDED" && a.summary === "Smoke test note"),
  );

  const badLead = await api("/notes", {
    token: agent,
    method: "POST",
    body: { leadId: "00000000-0000-0000-0000-000000000000", content: "orphan" },
  });
  check("a note against a missing lead is refused with 404", badLead.status === 404);
  check(
    "and the message is readable rather than a database error",
    String(badLead.body?.message ?? "").includes("does not exist"),
    String(badLead.body?.message),
  );

  console.log("\nAUTHORSHIP");
  const ai = aiOnly.body.data[0];
  const rewritten = await api(`/notes/${ai.id}`, {
    token: agent,
    method: "PATCH",
    body: { content: `${ai.content} (checked and corrected)` },
  });
  check("an AI note can be edited", rewritten.status === 200, JSON.stringify(rewritten.body));
  check(
    "editing an AI note transfers authorship away from the AI",
    rewritten.body?.isAiGenerated === false,
  );
  check("and stamps editedAt", Boolean(rewritten.body?.editedAt));

  const reEdited = await api(`/notes/${ai.id}`, {
    token: agent,
    method: "PATCH",
    body: { type: "OBJECTION" },
  });
  check("a metadata-only edit succeeds", reEdited.status === 200);
  check(
    "and does not move editedAt, because the words did not change",
    reEdited.body?.editedAt === rewritten.body?.editedAt,
  );

  const stolen = await api(`/notes/${noteId}`, {
    token: owner,
    method: "PATCH",
    body: { content: "The owner rewriting the agent's note." },
  });
  check(
    "an owner (who holds notes.delete) may edit someone else's note",
    stolen.status === 200,
    JSON.stringify(stolen.body),
  );

  const ownerNote = await api("/notes", {
    token: owner,
    method: "POST",
    body: { leadId, content: "Owner's own note for the authorship check." },
  });
  const agentEditsOwners = await api(`/notes/${ownerNote.body.id}`, {
    token: agent,
    method: "PATCH",
    body: { content: "An agent trying to rewrite the owner's note." },
  });
  check(
    "an agent may not rewrite a colleague's note",
    agentEditsOwners.status === 403,
    `got ${agentEditsOwners.status}`,
  );
  check(
    "and is told why, in words",
    String(agentEditsOwners.body?.message ?? "").includes("written by someone else"),
    String(agentEditsOwners.body?.message),
  );

  const agentDeletesOwners = await api(`/notes/${ownerNote.body.id}`, {
    token: agent,
    method: "DELETE",
  });
  check("an agent may not delete a colleague's note", agentDeletesOwners.status === 403);

  console.log("\nPERMISSIONS AND ISOLATION");
  if (viewer) {
    const viewerReads = await api("/notes?pageSize=1", { token: viewer });
    check("a viewer can read notes", viewerReads.status === 200);
    const viewerWrites = await api("/notes", {
      token: viewer,
      method: "POST",
      body: { leadId, content: "A viewer should not be able to write this." },
    });
    check("a viewer cannot create a note", viewerWrites.status === 403, `got ${viewerWrites.status}`);
  }

  if (outsider) {
    const crossTenant = await api(`/notes/${noteId}`, { token: outsider });
    check(
      "another workspace cannot read this note",
      crossTenant.status === 404,
      `got ${crossTenant.status}`,
    );
    const crossEdit = await api(`/notes/${noteId}`, {
      token: outsider,
      method: "PATCH",
      body: { content: "cross-tenant write" },
    });
    check("nor edit it", crossEdit.status === 404, `got ${crossEdit.status}`);

    const theirList = await api("/notes?pageSize=50", { token: outsider });
    const ids = new Set(all.body.data.map((n) => n.id));
    check(
      "and their list contains none of this workspace's notes",
      theirList.body.data.every((n) => !ids.has(n.id)),
    );
  }

  console.log("\nCLEAN-UP");
  const removed = await api(`/notes/${noteId}`, { token: owner, method: "DELETE" });
  check("a note can be deleted", removed.status === 200 || removed.status === 204);
  const gone = await api(`/notes/${noteId}`, { token: owner });
  check("and is then gone", gone.status === 404);
  await api(`/notes/${ownerNote.body.id}`, { token: owner, method: "DELETE" });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
