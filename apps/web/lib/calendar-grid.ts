/**
 * The date arithmetic the calendar grid needs, with no React and no data — so the parts
 * that are easy to get subtly wrong can be tested directly.
 *
 * Everything here works in the viewer's own timezone, which is the right frame for a
 * grid of days someone is looking at. The *queue* on Follow-ups deliberately does not:
 * "overdue" is a shared judgement and belongs to the workspace's clock. A calendar cell
 * is just "the box labelled Tuesday", and that is local by definition.
 */

export type CalendarView = "month" | "week" | "day";

export interface DayCell {
  /** Local midnight opening this day. */
  date: Date;
  /** False for the leading and trailing days a month grid borrows from its neighbours. */
  inFocus: boolean;
  isToday: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  // Built from the calendar fields rather than by adding milliseconds, so a day that is
  // 23 or 25 hours long because the clocks changed still advances by exactly one day.
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  const targetMonth = copy.getMonth() + months;
  copy.setDate(1);
  copy.setMonth(targetMonth);
  return copy;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Monday of the week containing `date`.
 *
 * Monday rather than Sunday because the product's calling windows and working days are
 * defined Monday-first, and a grid that starts on a different day from the settings that
 * govern it invites off-by-one reading errors every single week.
 */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  // getDay() is 0 for Sunday; map it to 6 so Monday is 0.
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

/**
 * The window a view covers, as a half-open `[from, to)` range to send to the API.
 *
 * A month view returns six full weeks, not the month — the grid shows the neighbouring
 * days, so events on them must be fetched too or the first and last rows sit suspiciously
 * empty.
 */
export function viewWindow(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  if (view === "day") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const from = startOfWeek(firstOfMonth);
  return { from, to: addDays(from, 42) };
}

/** The cells a month grid draws: six weeks from the Monday before the 1st. */
export function monthGrid(anchor: Date, today = new Date()): DayCell[] {
  const { from } = viewWindow("month", anchor);
  const month = anchor.getMonth();
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(from, index);
    return { date, inFocus: date.getMonth() === month, isToday: isSameDay(date, today) };
  });
}

export function weekGrid(anchor: Date, today = new Date()): DayCell[] {
  const from = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(from, index);
    return { date, inFocus: true, isToday: isSameDay(date, today) };
  });
}

/**
 * Whether an event touches a given day at all.
 *
 * Overlap rather than "starts on this day", for the same reason the API queries by
 * overlap: a meeting running from 23:00 to 00:30 belongs on both days, and an all-day
 * event spanning a week belongs on every one of them. Getting this wrong makes long
 * events vanish from the middle of their own duration.
 */
export function occursOn(event: { startAt: string; endAt: string }, day: Date): boolean {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + DAY_MS;
  const start = Date.parse(event.startAt);
  const end = Date.parse(event.endAt);
  return start < dayEnd && end > dayStart;
}

/** Events touching `day`, earliest first. */
export function eventsOn<T extends { startAt: string; endAt: string }>(
  events: T[],
  day: Date,
): T[] {
  return events
    .filter((event) => occursOn(event, day))
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

/** "9:00 AM". */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The heading over the grid: "September 2026", "8 – 14 Sep 2026", "Thu 10 Sep 2026". */
export function viewLabel(view: CalendarView, anchor: Date): string {
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  if (view === "week") {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    const sameMonth = from.getMonth() === to.getMonth();
    const left = from.toLocaleDateString(undefined, {
      day: "numeric",
      ...(sameMonth ? {} : { month: "short" }),
    });
    const right = to.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${left} – ${right}`;
  }
  return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
