import type { FollowUpStatus, Prisma } from "@prisma/client";

/**
 * The date arithmetic behind the follow-up queue, with no Prisma, no clock of its own and
 * no injected services — so every boundary it draws can be tested directly.
 *
 * The schema stores three states: PENDING, COMPLETED, CANCELLED. §21 of the spec also
 * lists "Today" and "Overdue", and those are deliberately not stored. Both are functions
 * of `dueAt` and the current time: a stored OVERDUE would have to be rewritten at midnight
 * in every timezone to stay true, and any row a nightly job missed would sit there lying
 * about itself. They are derived on read instead, from the workspace's clock rather than
 * the browser's — so a rep in one timezone and their manager in another see the same
 * queue and agree about what is late.
 */
export type DerivedFollowUpStatus = "PENDING" | "TODAY" | "OVERDUE" | "COMPLETED" | "CANCELLED";

export interface DayBounds {
  /** Local midnight at the start of the current day, as an instant. */
  start: Date;
  /** Local midnight at the start of the next day. Exclusive. */
  end: Date;
}

/**
 * How far ahead of UTC `timezone` is at `at`, in milliseconds.
 *
 * Read off the formatter rather than from a table: format the instant in the zone, then
 * ask what UTC instant those same wall-clock digits would name. The difference is the
 * offset in force at that moment, daylight saving included.
 */
function offsetMsAt(timezone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }

  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    // Some engines render midnight as hour 24 of the previous day.
    parts.hour === 24 ? 0 : parts.hour,
    parts.minute,
    parts.second,
  );

  // `at` carries milliseconds the parts do not; drop them from both sides.
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The calendar date `at` falls on, in `timezone`. */
export function localDate(timezone: string, at: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(at).split("-").map(Number);
  return { year, month, day };
}

/**
 * The instant at which a given local calendar day begins.
 *
 * The offset is applied twice on purpose. The first pass uses the offset in force at the
 * *current* moment, which on a day the clocks change is not the offset that was in force
 * at midnight — this is exactly the bug the naive "subtract the time of day" approach has,
 * and it puts an hour of work in the wrong bucket for the six months a zone is on daylight
 * saving. The second pass re-reads the offset at the candidate instant and corrects it.
 *
 * Where local midnight does not exist at all — a zone that springs forward at 00:00 — the
 * result lands on the first instant of the day that does exist, which is the only honest
 * answer available.
 */
export function startOfLocalDay(
  timezone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstGuess = wallClock - offsetMsAt(timezone, new Date(wallClock));
  return new Date(wallClock - offsetMsAt(timezone, new Date(firstGuess)));
}

/**
 * The instants that bracket "today" in `timezone`.
 *
 * `end` is the next local midnight rather than `start + 24h`, because on the days a zone
 * changes its clocks the day is 23 or 25 hours long. Adding a fixed day would either drop
 * an hour of follow-ups out of "today" or pull an hour of tomorrow's into it.
 */
export function dayBounds(timezone: string, at: Date = new Date()): DayBounds {
  const { year, month, day } = localDate(timezone, at);
  return {
    start: startOfLocalDay(timezone, year, month, day),
    // Built from the calendar date rather than by adding a day to `start`, so a 23- or
    // 25-hour day comes out the right length.
    end: localMidnightPlusDays(timezone, { year, month, day }, 1),
  };
}

/**
 * Local midnight `days` calendar days after the given date.
 *
 * Counting in calendar days rather than in multiples of 24 hours is what keeps "next
 * week" seven sleeps away rather than six-and-23-hours in a zone that changed its clocks
 * in between. `Date.UTC` does the month and year roll-over.
 */
export function localMidnightPlusDays(
  timezone: string,
  from: { year: number; month: number; day: number },
  days: number,
): Date {
  const shifted = new Date(Date.UTC(from.year, from.month - 1, from.day + days));
  return startOfLocalDay(
    timezone,
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** What the queue calls a row, given where its due date falls relative to today. */
export function deriveStatus(
  row: { status: FollowUpStatus; dueAt: Date },
  bounds: DayBounds,
): DerivedFollowUpStatus {
  if (row.status !== "PENDING") return row.status;
  if (row.dueAt < bounds.start) return "OVERDUE";
  if (row.dueAt < bounds.end) return "TODAY";
  return "PENDING";
}

/**
 * A derived status as a database filter.
 *
 * The three PENDING-derived states partition the pending rows rather than overlapping:
 * "Pending" means still upcoming, because Today and Overdue are offered beside it in the
 * same control. If it also matched those, picking each of the three in turn would return
 * overlapping sets whose counts do not add up to the total — and a filter bar whose
 * numbers do not reconcile is one people stop trusting.
 */
export function statusClause(
  status: DerivedFollowUpStatus,
  bounds: DayBounds,
): Prisma.FollowUpWhereInput {
  switch (status) {
    case "OVERDUE":
      return { status: "PENDING", dueAt: { lt: bounds.start } };
    case "TODAY":
      return { status: "PENDING", dueAt: { gte: bounds.start, lt: bounds.end } };
    case "PENDING":
      return { status: "PENDING", dueAt: { gte: bounds.end } };
    default:
      return { status };
  }
}

export type DueWithin = "today" | "tomorrow" | "week" | "past";

/**
 * The "due within" control, as a range over `dueAt`.
 *
 * Measured from local midnight rather than from now, so "this week" means the next seven
 * calendar days and not a rolling 168 hours. That is what someone planning their week
 * means by it, and it has the useful property of returning the same set twice in a row an
 * hour apart.
 */
export function dueWindow(
  dueWithin: DueWithin | undefined,
  timezone: string,
  at: Date = new Date(),
): Prisma.DateTimeFilter | null {
  if (!dueWithin) return null;

  const today = localDate(timezone, at);
  const bounds = dayBounds(timezone, at);

  switch (dueWithin) {
    case "today":
      return { gte: bounds.start, lt: bounds.end };
    case "tomorrow":
      return { gte: bounds.end, lt: localMidnightPlusDays(timezone, today, 2) };
    case "week":
      return { gte: bounds.start, lt: localMidnightPlusDays(timezone, today, 7) };
    case "past":
      return { lt: bounds.start };
  }
}
