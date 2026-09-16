import {
  addDays,
  addMonths,
  eventsOn,
  isSameDay,
  monthGrid,
  occursOn,
  startOfDay,
  startOfWeek,
  viewWindow,
  weekGrid,
} from "./calendar-grid";

/**
 * The bugs a calendar grid actually has are all off-by-one: a month that starts on the
 * wrong weekday, a 31st that lands in the next row, an event that vanishes from the
 * middle of its own duration. Each of these tests names one of those.
 */
describe("startOfWeek", () => {
  it("returns the Monday of the week", () => {
    // 10 September 2026 is a Thursday.
    const monday = startOfWeek(new Date(2026, 8, 10, 15, 30));
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(7);
  });

  it("treats Sunday as the last day of the week, not the first", () => {
    // 13 September 2026 is a Sunday; its week began on the 7th.
    const monday = startOfWeek(new Date(2026, 8, 13));
    expect(monday.getDate()).toBe(7);
  });

  it("leaves a Monday where it is", () => {
    const monday = startOfWeek(new Date(2026, 8, 7, 9));
    expect(monday.getDate()).toBe(7);
    expect(monday.getHours()).toBe(0);
  });

  it("walks back into the previous month when it has to", () => {
    // 1 September 2026 is a Tuesday, so its week began on 31 August.
    const monday = startOfWeek(new Date(2026, 8, 1));
    expect(monday.getMonth()).toBe(7);
    expect(monday.getDate()).toBe(31);
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    const next = addDays(new Date(2026, 0, 31), 1);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(1);
  });

  it("crosses a year boundary", () => {
    const next = addDays(new Date(2026, 11, 31), 1);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
  });

  it("keeps the wall-clock hour across a daylight-saving change", () => {
    // Adding 24h of milliseconds would land on 09:00 or 11:00 depending on direction;
    // advancing the calendar field keeps 10:00.
    const before = new Date(2026, 2, 7, 10, 0);
    const after = addDays(before, 1);
    expect(after.getHours()).toBe(10);
    expect(after.getDate()).toBe(8);
  });
});

describe("addMonths", () => {
  it("does not overflow when the target month is shorter", () => {
    // Naively setting the month on a 31st rolls 31 January into 3 March.
    const next = addMonths(new Date(2026, 0, 31), 1);
    expect(next.getMonth()).toBe(1);
  });

  it("goes backwards across a year boundary", () => {
    const previous = addMonths(new Date(2026, 0, 15), -1);
    expect(previous.getFullYear()).toBe(2025);
    expect(previous.getMonth()).toBe(11);
  });
});

describe("viewWindow", () => {
  it("gives a day view exactly one day", () => {
    const { from, to } = viewWindow("day", new Date(2026, 8, 10, 13));
    expect(from.getHours()).toBe(0);
    expect(to.getDate()).toBe(11);
  });

  it("gives a week view Monday to the following Monday", () => {
    const { from, to } = viewWindow("week", new Date(2026, 8, 10));
    expect(from.getDay()).toBe(1);
    expect(to.getDay()).toBe(1);
    expect(to.getDate() - from.getDate()).toBe(7);
  });

  /**
   * The month view draws six weeks including the neighbouring days, so the window has to
   * cover them too. Asking only for the month itself leaves the first and last rows
   * looking empty — a bug that reads as "there is nothing on", which is worse than a
   * visible error.
   */
  it("gives a month view six full weeks, starting before the 1st", () => {
    const { from, to } = viewWindow("month", new Date(2026, 8, 15));
    expect(from.getDay()).toBe(1);
    expect(from.getMonth()).toBe(7);
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(42);
  });
});

describe("monthGrid", () => {
  it("always draws 42 cells", () => {
    expect(monthGrid(new Date(2026, 1, 15))).toHaveLength(42);
    expect(monthGrid(new Date(2026, 4, 15))).toHaveLength(42);
  });

  it("marks only the anchor month's days as in focus", () => {
    const cells = monthGrid(new Date(2026, 8, 15));
    expect(cells.filter((c) => c.inFocus)).toHaveLength(30);
    expect(cells.every((c) => !c.inFocus || c.date.getMonth() === 8)).toBe(true);
  });

  it("covers every day of the month with no gaps", () => {
    const cells = monthGrid(new Date(2026, 0, 15));
    const days = cells.filter((c) => c.inFocus).map((c) => c.date.getDate());
    expect(days).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("marks today, and only today", () => {
    const today = new Date(2026, 8, 10);
    const cells = monthGrid(today, today);
    expect(cells.filter((c) => c.isToday)).toHaveLength(1);
    expect(cells.find((c) => c.isToday)!.date.getDate()).toBe(10);
  });

  it("handles a February that starts on a Sunday", () => {
    // 1 February 2026 is a Sunday — the worst case, six days of January in the first row.
    const cells = monthGrid(new Date(2026, 1, 10));
    expect(cells[0].date.getMonth()).toBe(0);
    expect(cells[0].date.getDate()).toBe(26);
    expect(cells.filter((c) => c.inFocus)).toHaveLength(28);
  });
});

describe("weekGrid", () => {
  it("draws seven days from Monday", () => {
    const cells = weekGrid(new Date(2026, 8, 10));
    expect(cells).toHaveLength(7);
    expect(cells[0].date.getDay()).toBe(1);
    expect(cells[6].date.getDay()).toBe(0);
  });

  it("has every cell in focus — a week view borrows nothing", () => {
    expect(weekGrid(new Date(2026, 8, 10)).every((c) => c.inFocus)).toBe(true);
  });
});

describe("occursOn", () => {
  const day = new Date(2026, 8, 10);
  const event = (startAt: Date, endAt: Date) => ({
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  });

  it("matches an event contained in the day", () => {
    expect(occursOn(event(new Date(2026, 8, 10, 9), new Date(2026, 8, 10, 10)), day)).toBe(true);
  });

  /** The one that a "starts on this day" filter gets wrong. */
  it("matches an event that started yesterday and ends today", () => {
    expect(occursOn(event(new Date(2026, 8, 9, 22), new Date(2026, 8, 10, 1)), day)).toBe(true);
  });

  it("matches an event that spans the whole day without starting or ending in it", () => {
    expect(occursOn(event(new Date(2026, 8, 8), new Date(2026, 8, 12)), day)).toBe(true);
  });

  it("does not match an event that ends exactly at midnight", () => {
    expect(occursOn(event(new Date(2026, 8, 9, 22), new Date(2026, 8, 10, 0, 0, 0)), day)).toBe(
      false,
    );
  });

  it("matches an event that starts exactly at midnight", () => {
    expect(occursOn(event(new Date(2026, 8, 10, 0, 0, 0), new Date(2026, 8, 10, 1)), day)).toBe(
      true,
    );
  });

  it("does not match the day before or after", () => {
    const e = event(new Date(2026, 8, 10, 9), new Date(2026, 8, 10, 10));
    expect(occursOn(e, addDays(day, -1))).toBe(false);
    expect(occursOn(e, addDays(day, 1))).toBe(false);
  });
});

describe("eventsOn", () => {
  it("returns the day's events earliest first, whatever order they arrived in", () => {
    const events = [
      { id: "late", startAt: new Date(2026, 8, 10, 16).toISOString(), endAt: new Date(2026, 8, 10, 17).toISOString() },
      { id: "early", startAt: new Date(2026, 8, 10, 9).toISOString(), endAt: new Date(2026, 8, 10, 10).toISOString() },
      { id: "other-day", startAt: new Date(2026, 8, 12, 9).toISOString(), endAt: new Date(2026, 8, 12, 10).toISOString() },
    ];
    expect(eventsOn(events, new Date(2026, 8, 10)).map((e) => e.id)).toEqual(["early", "late"]);
  });

  it("returns an empty list rather than throwing on an empty day", () => {
    expect(eventsOn([], new Date(2026, 8, 10))).toEqual([]);
  });
});

describe("isSameDay", () => {
  it("ignores the time of day", () => {
    expect(isSameDay(new Date(2026, 8, 10, 0, 1), new Date(2026, 8, 10, 23, 59))).toBe(true);
  });

  it("does not confuse the same date in different months or years", () => {
    expect(isSameDay(new Date(2026, 8, 10), new Date(2026, 9, 10))).toBe(false);
    expect(isSameDay(new Date(2026, 8, 10), new Date(2025, 8, 10))).toBe(false);
  });
});

describe("startOfDay", () => {
  it("zeroes the clock without moving the date", () => {
    const start = startOfDay(new Date(2026, 8, 10, 23, 59, 59, 999));
    expect(start.getDate()).toBe(10);
    expect(start.getHours()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it("does not mutate its argument", () => {
    const original = new Date(2026, 8, 10, 15, 30);
    startOfDay(original);
    expect(original.getHours()).toBe(15);
  });
});
