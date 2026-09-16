/**
 * Drives the Calendar against the running API.
 *
 * The claim worth checking hardest is overlap: an event that starts before the window
 * and ends inside it belongs on the view, and the obvious implementation — filter on
 * `startAt` — silently drops exactly those. Everything else here is the usual: an
 * unbounded read is refused, moving an event moves the follow-up it came from, and one
 * workspace cannot see another's diary.
 *
 *   node scripts/calendar-smoke.mjs
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

const at = (offsetDays, hour, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const windowAround = (days = 30) => ({
  from: at(-days, 0).toISOString(),
  to: at(days, 0).toISOString(),
});

async function main() {
  const owner = await login("northwind", "owner@northwind.test");
  const agent = await login("northwind", "agent@northwind.test");
  const viewer = await login("northwind", "viewer@northwind.test");
  const outsider = await login("cobalt", "owner@cobalt.test");
  if (!owner) throw new Error("could not sign in — is the API running and seeded?");

  const leads = await api("/leads?pageSize=1", { token: owner });
  const leadId = leads.body?.data?.[0]?.id;

  console.log("THE WINDOW IS REQUIRED");
  const unbounded = await api("/calendar/events", { token: owner });
  check("a read with no window is refused", unbounded.status === 400, `got ${unbounded.status}`);

  const backwards = await api(
    `/calendar/events?from=${at(5, 0).toISOString()}&to=${at(1, 0).toISOString()}`,
    { token: owner },
  );
  check("a window that ends before it starts is refused", backwards.status === 400);

  const enormous = await api(
    `/calendar/events?from=${at(-900, 0).toISOString()}&to=${at(900, 0).toISOString()}`,
    { token: owner },
  );
  check("an absurdly wide window is refused rather than served", enormous.status === 400);

  console.log("\nOVERLAP");
  const created = await api("/calendar/events", {
    token: agent,
    method: "POST",
    body: {
      title: "Smoke long meeting",
      type: "MEETING",
      // Runs from three days before the probe window to two days inside it.
      startAt: at(3, 9).toISOString(),
      endAt: at(8, 17).toISOString(),
      location: "Zoom",
      leadId,
    },
  });
  check("an agent can create an event", created.status === 201, JSON.stringify(created.body));
  const id = created.body?.id;

  // A window that begins after the event started and ends before it finished: the event
  // contains the window entirely. Nothing about its start or end is inside it.
  const inside = await api(
    `/calendar/events?from=${at(5, 0).toISOString()}&to=${at(6, 0).toISOString()}`,
    { token: owner },
  );
  check(
    "an event spanning the whole window still appears in it",
    inside.body.some((e) => e.id === id),
    "this is the bug a startAt-only filter has",
  );

  const before = await api(
    `/calendar/events?from=${at(1, 0).toISOString()}&to=${at(2, 0).toISOString()}`,
    { token: owner },
  );
  check(
    "an event entirely after the window does not appear",
    !before.body.some((e) => e.id === id),
  );

  const touching = await api(
    `/calendar/events?from=${at(8, 17).toISOString()}&to=${at(9, 0).toISOString()}`,
    { token: owner },
  );
  check(
    "a window starting exactly when an event ends excludes it — half-open, not sloppy",
    !touching.body.some((e) => e.id === id),
  );

  console.log("\nVALIDATION");
  const zeroLength = await api("/calendar/events", {
    token: agent,
    method: "POST",
    body: { title: "Instant", startAt: at(2, 10).toISOString(), endAt: at(2, 10).toISOString() },
  });
  check("a zero-length event is refused", zeroLength.status === 400);

  const inverted = await api("/calendar/events", {
    token: agent,
    method: "POST",
    body: { title: "Backwards", startAt: at(2, 12).toISOString(), endAt: at(2, 10).toISOString() },
  });
  check("an event that ends before it starts is refused", inverted.status === 400);

  const orphan = await api("/calendar/events", {
    token: agent,
    method: "POST",
    body: {
      title: "Orphan",
      startAt: at(2, 10).toISOString(),
      endAt: at(2, 11).toISOString(),
      leadId: "00000000-0000-0000-0000-000000000000",
    },
  });
  check("an event against a missing lead is refused with 404", orphan.status === 404);

  console.log("\nMOVING A LINKED EVENT MOVES ITS FOLLOW-UP");
  const all = await api(`/calendar/events?from=${windowAround(60).from}&to=${windowAround(60).to}`, {
    token: owner,
  });
  const linked = all.body.find((e) => e.followUpId);
  if (linked) {
    const followUpBefore = await api(`/follow-ups/${linked.followUpId}`, { token: owner });
    const newStart = new Date(Date.parse(linked.startAt) + 2 * 60 * 60 * 1000);
    const moved = await api(`/calendar/events/${linked.id}`, {
      token: agent,
      method: "PATCH",
      body: {
        startAt: newStart.toISOString(),
        endAt: new Date(Date.parse(linked.endAt) + 2 * 60 * 60 * 1000).toISOString(),
      },
    });
    check("a linked event can be moved", moved.status === 200);

    const followUpAfter = await api(`/follow-ups/${linked.followUpId}`, { token: owner });
    check(
      "and the follow-up it came from moves with it",
      Date.parse(followUpAfter.body.dueAt) === newStart.getTime(),
      `${followUpAfter.body?.dueAt} vs ${newStart.toISOString()}`,
    );
    check(
      "and its reminder is re-armed for the new time",
      followUpAfter.body?.reminderSentAt === null,
    );

    // Put it back.
    await api(`/calendar/events/${linked.id}`, {
      token: agent,
      method: "PATCH",
      body: { startAt: linked.startAt, endAt: linked.endAt },
    });
    await api(`/follow-ups/${linked.followUpId}`, {
      token: agent,
      method: "PATCH",
      body: { dueAt: followUpBefore.body.dueAt },
    });
  } else {
    check("the seed contains an event linked to a follow-up", false, "none found");
  }

  console.log("\nSTATS AND FILTERS");
  const stats = await api("/calendar/stats", { token: owner });
  check("stats come back as numbers", typeof stats.body?.today === "number");
  check(
    "the next seven days is never fewer than today",
    stats.body.thisWeek >= stats.body.today,
    `${stats.body?.thisWeek} vs ${stats.body?.today}`,
  );

  const demosOnly = await api(
    `/calendar/events?from=${windowAround(60).from}&to=${windowAround(60).to}&type=DEMO`,
    { token: owner },
  );
  check(
    "a type filter is applied server-side",
    demosOnly.body.every((e) => e.type === "DEMO"),
  );

  const searched = await api(
    `/calendar/events?from=${windowAround(60).from}&to=${windowAround(60).to}&search=Smoke%20long`,
    { token: owner },
  );
  check("search matches on title", searched.body.some((e) => e.id === id));

  console.log("\nPERMISSIONS AND ISOLATION");
  if (viewer) {
    const viewerReads = await api(
      `/calendar/events?from=${windowAround().from}&to=${windowAround().to}`,
      { token: viewer },
    );
    check("a viewer can read the calendar", viewerReads.status === 200);
    const viewerWrites = await api("/calendar/events", {
      token: viewer,
      method: "POST",
      body: { title: "Nope", startAt: at(2, 10).toISOString(), endAt: at(2, 11).toISOString() },
    });
    check("a viewer cannot book anything", viewerWrites.status === 403);
  }

  if (outsider) {
    const crossRead = await api(`/calendar/events/${id}`, { token: outsider });
    check("another workspace cannot read this event", crossRead.status === 404);
    const crossWrite = await api(`/calendar/events/${id}`, {
      token: outsider,
      method: "PATCH",
      body: { title: "theirs now" },
    });
    check("nor rename it", crossWrite.status === 404);

    const theirWindow = await api(
      `/calendar/events?from=${windowAround(60).from}&to=${windowAround(60).to}`,
      { token: outsider },
    );
    check(
      "and their window contains none of this workspace's events",
      !theirWindow.body.some((e) => e.id === id),
    );
  }

  console.log("\nCLEAN-UP");
  const removed = await api(`/calendar/events/${id}`, { token: owner, method: "DELETE" });
  check("an event can be deleted", removed.status === 204 || removed.status === 200);
  const gone = await api(`/calendar/events/${id}`, { token: owner });
  check("and is then gone", gone.status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
