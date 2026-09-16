/**
 * End-to-end smoke test against a running API.
 *
 * This is not a replacement for the jest suites — those test units and isolation against
 * a test database. This drives the real HTTP surface the browser uses, in order, and is
 * how a claim like "campaigns work" gets checked rather than asserted.
 *
 *   node scripts/smoke.mjs
 *
 * Exits non-zero on the first failure so it can gate a commit.
 */
const BASE = process.env.SMOKE_API ?? "http://localhost:4000/api";
const PASSWORD = "Appsgain#2026";

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

/**
 * The dev database (scripts/dev-db.mjs) is PostgreSQL compiled to WebAssembly running in
 * a single process, and it drops the occasional connection when a script fires requests
 * back-to-back with no gap — which showed up here as a spurious 500 on one assertion out
 * of thirty-two. A real Postgres does not need this, and neither does the API: the pause
 * is a concession to the stand-in database, not a workaround for application code.
 */
const PACE_MS = Number(process.env.SMOKE_PACE_MS ?? 120);
const pace = () => new Promise((resolve) => setTimeout(resolve, PACE_MS));

async function api(path, { token, method = "GET", body } = {}) {
  await pace();
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

  // A query that errors — the deliberate unique-constraint rejection below, for one —
  // leaves the dev database's connection unusable, so the *next* request on it comes
  // back 500 even though the endpoint is fine. Verified by driving the same endpoint in
  // isolation, where it returns the correct 400 every time. Waiting lets the pool hand
  // out a fresh connection. Again: a property of the WASM stand-in, not of the API.
  if (response.status >= 400) await new Promise((resolve) => setTimeout(resolve, 400));

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
  console.log("AUTH");
  const owner = await login("northwind", "owner@northwind.test");
  const viewer = await login("northwind", "viewer@northwind.test");
  const other = await login("cobalt", "owner@cobalt.test");
  check("owner signs in", Boolean(owner));
  check("viewer signs in", Boolean(viewer));
  check("second workspace signs in", Boolean(other));

  const bad = await api("/auth/login", {
    method: "POST",
    body: { subdomain: "northwind", email: "owner@northwind.test", password: "wrong" },
  });
  check("wrong password is rejected", bad.status === 401, `got ${bad.status}`);

  console.log("\nTENANT ISOLATION");
  const nwLeads = await api("/leads?pageSize=1", { token: owner });
  const cbLeads = await api("/leads?pageSize=1", { token: other });
  check("workspace A sees its own leads", nwLeads.body.total === 60, `got ${nwLeads.body.total}`);
  check("workspace B sees its own leads", cbLeads.body.total === 25, `got ${cbLeads.body.total}`);

  const aLeadId = nwLeads.body.data[0].id;
  const crossRead = await api(`/leads/${aLeadId}`, { token: other });
  check(
    "workspace B cannot read workspace A's lead",
    crossRead.status === 404,
    `got ${crossRead.status}`,
  );

  const anon = await api("/leads");
  check("no token is rejected", anon.status === 401, `got ${anon.status}`);

  console.log("\nRBAC");
  const viewerDelete = await api(`/leads/${aLeadId}`, { token: viewer, method: "DELETE" });
  check("viewer cannot delete a lead", viewerDelete.status === 403, `got ${viewerDelete.status}`);
  check(
    "the refusal names the missing permission",
    String(viewerDelete.body?.message).includes("leads.delete"),
    String(viewerDelete.body?.message),
  );

  const viewerCreate = await api("/campaigns", {
    token: viewer,
    method: "POST",
    body: { name: `Viewer attempt ${Date.now()}` },
  });
  check("viewer cannot create a campaign", viewerCreate.status === 403, `got ${viewerCreate.status}`);

  console.log("\nLEADS — server-side query");
  const converted = await api("/leads?status=CONVERTED&pageSize=100", { token: owner });
  check(
    "status filter narrows the total",
    converted.body.total < 60 && converted.body.total > 0,
    `got ${converted.body.total}`,
  );
  check(
    "every returned row matches the filter",
    converted.body.data.every((l) => l.status === "CONVERTED"),
  );

  const page2 = await api("/leads?pageSize=5&page=2", { token: owner });
  check("pagination returns the requested page", page2.body.page === 2 && page2.body.data.length === 5);
  check(
    "page 2 does not repeat page 1",
    page2.body.data[0].id !== nwLeads.body.data[0].id,
  );

  const stats = await api("/leads/stats", { token: owner });
  check("stats total matches the list total", stats.body.total === 60, `got ${stats.body.total}`);

  console.log("\nCAMPAIGNS — lifecycle");
  const name = `Smoke ${Date.now()}`;
  const created = await api("/campaigns", { token: owner, method: "POST", body: { name } });
  check("campaign is created", created.status === 201, `got ${created.status}`);
  check("a new campaign starts as DRAFT", created.body?.status === "DRAFT", created.body?.status);
  const id = created.body?.id;

  const dupName = await api("/campaigns", { token: owner, method: "POST", body: { name } });
  // 409 specifically, not ">= 400": the loose version passed on a 500 and hid an
  // unhandled constraint error for a whole test run.
  check("a duplicate name is a 409, not a 500", dupName.status === 409, `got ${dupName.status}`);

  const activateBare = await api(`/campaigns/${id}/activate`, { token: owner, method: "POST" });
  check(
    "activating an unconfigured campaign is refused",
    activateBare.status === 400,
    `got ${activateBare.status}`,
  );
  check(
    "the refusal explains what is missing",
    String(activateBare.body?.message).includes("agent") &&
      String(activateBare.body?.message).includes("lead"),
    String(activateBare.body?.message),
  );

  const illegal = await api(`/campaigns/${id}/pause`, { token: owner, method: "POST" });
  check("DRAFT cannot go straight to PAUSED", illegal.status === 400, `got ${illegal.status}`);

  console.log("\nCAMPAIGNS — lead assignment");
  const someLeads = await api("/leads?pageSize=3", { token: owner });
  const leadIds = someLeads.body.data.map((l) => l.id);
  const add1 = await api(`/campaigns/${id}/leads`, {
    token: owner,
    method: "POST",
    body: { leadIds },
  });
  check("leads are added", add1.body?.added === 3, JSON.stringify(add1.body));

  const add2 = await api(`/campaigns/${id}/leads`, {
    token: owner,
    method: "POST",
    body: { leadIds },
  });
  check(
    "re-adding the same leads adds none",
    add2.body?.added === 0 && add2.body?.skipped === 3,
    JSON.stringify(add2.body),
  );

  const withLeads = await api(`/campaigns/${id}`, { token: owner });
  check("campaign stats reflect the added leads", withLeads.body?.stats?.leads === 3, JSON.stringify(withLeads.body?.stats));

  const crossAdd = await api(`/campaigns/${id}/leads`, {
    token: other,
    method: "POST",
    body: { leadIds },
  });
  check(
    "another workspace cannot add leads to this campaign",
    crossAdd.status === 404,
    `got ${crossAdd.status}`,
  );

  await api(`/campaigns/${id}/leads/${leadIds[0]}`, { token: owner, method: "DELETE" });
  const afterRemove = await api(`/campaigns/${id}`, { token: owner });
  check("removing a lead updates the count", afterRemove.body?.stats?.leads === 2, JSON.stringify(afterRemove.body?.stats));

  console.log("\nCAMPAIGNS — duplicate and delete");
  const copy = await api(`/campaigns/${id}/duplicate`, { token: owner, method: "POST" });
  check("duplicate is created as DRAFT", copy.body?.status === "DRAFT", copy.body?.status);
  check("duplicate is renamed", copy.body?.name === `${name} (copy)`, copy.body?.name);
  check("duplicate does not inherit leads", copy.body?.stats?.leads === 0, JSON.stringify(copy.body?.stats));

  const withHistory = await api("/campaigns?pageSize=50", { token: owner });
  const hasCalls = withHistory.body.data.find((c) => c.stats.calls > 0);
  if (hasCalls) {
    const refuse = await api(`/campaigns/${hasCalls.id}`, { token: owner, method: "DELETE" });
    check(
      "a campaign with call history cannot be deleted",
      refuse.status === 400,
      `got ${refuse.status}`,
    );
  }

  const del = await api(`/campaigns/${id}`, { token: owner, method: "DELETE" });
  check("a draft with no calls can be deleted", del.status === 204, `got ${del.status}`);
  await api(`/campaigns/${copy.body?.id}`, { token: owner, method: "DELETE" });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("smoke run failed:", error.message);
  process.exit(1);
});
