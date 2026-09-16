/**
 * Drives AI Agents against the running API.
 *
 * The claims that matter here are about not destroying history: an agent that has made
 * calls cannot be deleted, because those calls record who said what; a duplicate arrives
 * off duty so nothing live picks up an unread script; and names stay unique per workspace
 * without leaking across workspaces.
 *
 *   node scripts/agents-smoke.mjs
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
  const manager = await login("northwind", "manager@northwind.test");
  const agentUser = await login("northwind", "agent@northwind.test");
  const outsider = await login("cobalt", "owner@cobalt.test");
  if (!owner) throw new Error("could not sign in — is the API running and seeded?");

  console.log("LISTING");
  const all = await api("/agents", { token: owner });
  check("agents list", all.status === 200 && Array.isArray(all.body));
  check("the seed has agents", all.body.length > 0, `got ${all.body?.length}`);
  check(
    "each carries its call and campaign counts",
    all.body.every((a) => typeof a._count?.calls === "number"),
  );
  check(
    "active agents sort ahead of inactive ones",
    all.body.every((a, i) => i === 0 || !(a.isActive && !all.body[i - 1].isActive)),
  );

  const stats = await api("/agents/stats", { token: owner });
  check("stats come back as numbers", typeof stats.body?.total === "number");
  check(
    "stats total matches the list",
    stats.body.total === all.body.length,
    `${stats.body?.total} vs ${all.body?.length}`,
  );
  check(
    "connect rate is a whole percentage between 0 and 100",
    Number.isInteger(stats.body.connectRate) &&
      stats.body.connectRate >= 0 &&
      stats.body.connectRate <= 100,
    String(stats.body?.connectRate),
  );

  console.log("\nCREATING");
  const unique = `Smoke Agent ${Date.now()}`;
  const created = await api("/agents", {
    token: manager,
    method: "POST",
    body: {
      name: unique,
      language: "en-IN",
      gender: "female",
      personality: "Direct, brief.",
      openingMessage: "Hello, may I have a moment?",
      qualificationQuestions: [
        { id: "q1", question: "How many seats do you need?", captures: "seats", required: true },
      ],
      objectionHandling: [
        { id: "o1", objection: "Too expensive", response: "Ask what they compare it against." },
      ],
    },
  });
  check("a manager can create an agent", created.status === 201, JSON.stringify(created.body));
  const id = created.body?.id;
  check("it starts on duty", created.body?.isActive === true);
  check(
    "its script round-trips",
    created.body?.qualificationQuestions?.[0]?.question === "How many seats do you need?",
  );

  const duplicateName = await api("/agents", {
    token: manager,
    method: "POST",
    body: { name: unique },
  });
  check("a duplicate name is refused with 409", duplicateName.status === 409, `got ${duplicateName.status}`);
  check(
    "and says which name is taken",
    String(duplicateName.body?.message ?? "").includes(unique),
  );

  const blank = await api("/agents", { token: manager, method: "POST", body: { name: "   " } });
  check("a blank name is refused", blank.status === 400, `got ${blank.status}`);

  const badLanguage = await api("/agents", {
    token: manager,
    method: "POST",
    body: { name: `${unique} 2`, language: "xx-XX" },
  });
  check("an unsupported language is refused at the edge", badLanguage.status === 400);

  console.log("\nDUPLICATING");
  const copy = await api(`/agents/${id}/duplicate`, { token: manager, method: "POST" });
  check("an agent can be duplicated", copy.status === 201, JSON.stringify(copy.body));
  check("the copy is off duty", copy.body?.isActive === false);
  check("the copy has its own name", copy.body?.name !== unique, copy.body?.name);
  check(
    "and carries the script over",
    copy.body?.qualificationQuestions?.[0]?.question === "How many seats do you need?",
  );

  const secondCopy = await api(`/agents/${id}/duplicate`, { token: manager, method: "POST" });
  check(
    "duplicating twice does not collide",
    secondCopy.status === 201 && secondCopy.body.name !== copy.body.name,
    `${copy.body?.name} vs ${secondCopy.body?.name}`,
  );

  console.log("\nEDITING");
  const renamed = await api(`/agents/${id}`, {
    token: manager,
    method: "PATCH",
    body: { personality: "Warm, unhurried.", isActive: false },
  });
  check("an agent can be edited", renamed.status === 200);
  check("and taken off duty", renamed.body?.isActive === false);

  const clash = await api(`/agents/${id}`, {
    token: manager,
    method: "PATCH",
    body: { name: copy.body.name },
  });
  check("renaming onto another agent's name is refused", clash.status === 409);

  const emptyScript = await api(`/agents/${id}`, {
    token: manager,
    method: "PATCH",
    body: { qualificationQuestions: [] },
  });
  check("a script can be emptied", emptyScript.status === 200);
  check(
    "and comes back empty rather than null",
    Array.isArray(emptyScript.body?.qualificationQuestions),
  );

  console.log("\nDELETING PROTECTS HISTORY");
  const used = all.body.find((a) => a._count.calls > 0);
  if (used) {
    const refused = await api(`/agents/${used.id}`, { token: owner, method: "DELETE" });
    check(
      "an agent with a call history cannot be deleted",
      refused.status === 409,
      `got ${refused.status}`,
    );
    check(
      "and the message says to deactivate it instead",
      String(refused.body?.message ?? "").includes("Deactivate"),
      String(refused.body?.message),
    );
  } else {
    check("the seed has an agent with calls", false, "none found");
  }

  console.log("\nPERMISSIONS AND ISOLATION");
  const agentReads = await api("/agents", { token: agentUser });
  check("an agent-role user can read the list", agentReads.status === 200);
  const agentWrites = await api("/agents", {
    token: agentUser,
    method: "POST",
    body: { name: `Nope ${Date.now()}` },
  });
  check("but cannot write a script", agentWrites.status === 403, `got ${agentWrites.status}`);

  if (outsider) {
    const crossRead = await api(`/agents/${id}`, { token: outsider });
    check("another workspace cannot read this agent", crossRead.status === 404);
    const crossWrite = await api(`/agents/${id}`, {
      token: outsider,
      method: "PATCH",
      body: { personality: "theirs" },
    });
    check("nor edit it", crossWrite.status === 404);

    const sameName = await api("/agents", {
      token: outsider,
      method: "POST",
      body: { name: unique },
    });
    check(
      "and can use the same name — uniqueness is per workspace, not global",
      sameName.status === 201,
      `got ${sameName.status}`,
    );
    if (sameName.status === 201) {
      await api(`/agents/${sameName.body.id}`, { token: outsider, method: "DELETE" });
    }
  }

  console.log("\nCLEAN-UP");
  for (const target of [id, copy.body?.id, secondCopy.body?.id].filter(Boolean)) {
    await api(`/agents/${target}`, { token: owner, method: "DELETE" });
  }
  const gone = await api(`/agents/${id}`, { token: owner });
  check("unused agents can be deleted", gone.status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
