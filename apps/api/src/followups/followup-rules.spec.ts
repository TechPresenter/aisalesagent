import {
  dayBounds,
  deriveStatus,
  dueWindow,
  statusClause,
  type DayBounds,
} from "./followup-rules";

/**
 * These are boundary tests, because every bug this file can have is a boundary bug: a
 * follow-up due at 23:59 counted as tomorrow's, one due at midnight counted as yesterday's,
 * or an hour's worth of work in the wrong bucket for the six months a timezone is on
 * daylight saving.
 */
describe("dayBounds", () => {
  it("brackets the day the instant falls in, in UTC", () => {
    const { start, end } = dayBounds("UTC", new Date("2026-09-10T14:37:22.512Z"));
    expect(start.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("is exactly 24 hours wide on an ordinary day", () => {
    const { start, end } = dayBounds("Asia/Kolkata", new Date("2026-09-10T14:37:22Z"));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("rolls over the end of a month", () => {
    const { start, end } = dayBounds("UTC", new Date("2026-01-31T09:00:00Z"));
    expect(start.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("uses the workspace's midnight, not the server's", () => {
    // 02:00 UTC on the 10th is already 07:30 on the 10th in Kolkata, so their day started
    // at 18:30 UTC on the 9th.
    const { start } = dayBounds("Asia/Kolkata", new Date("2026-09-10T02:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-09T18:30:00.000Z");
  });

  it("puts a late-evening UTC instant into the next day for a timezone that is ahead", () => {
    // 20:00 UTC on the 10th is 01:30 on the 11th in Kolkata.
    const { start } = dayBounds("Asia/Kolkata", new Date("2026-09-10T20:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-10T18:30:00.000Z");
  });

  it("handles a half-hour offset without rounding it away", () => {
    const { start } = dayBounds("Asia/Kolkata", new Date("2026-01-15T12:00:00Z"));
    expect(start.getUTCMinutes()).toBe(30);
  });

  it("tracks a daylight-saving change rather than assuming a fixed offset", () => {
    // New York is UTC-4 in July and UTC-5 in January. A fixed-offset implementation gets
    // one of these two wrong by an hour.
    const summer = dayBounds("America/New_York", new Date("2026-07-15T12:00:00Z"));
    const winter = dayBounds("America/New_York", new Date("2026-01-15T12:00:00Z"));
    expect(summer.start.toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(winter.start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("is 23 hours wide on the day a timezone springs forward", () => {
    // 8 March 2026, New York loses an hour at 02:00 local. Midnight that morning is still
    // EST (UTC-5); midnight the next morning is EDT (UTC-4).
    const { start, end } = dayBounds("America/New_York", new Date("2026-03-08T18:00:00Z"));
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("is 25 hours wide on the day a timezone falls back", () => {
    // 1 November 2026, New York gains an hour at 02:00 local.
    const { start, end } = dayBounds("America/New_York", new Date("2026-11-01T18:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it("drops sub-second precision so midnight is exactly midnight", () => {
    const { start } = dayBounds("UTC", new Date("2026-09-10T14:37:22.999Z"));
    expect(start.getUTCMilliseconds()).toBe(0);
  });

  it("treats an unknown timezone as a failure rather than silently using the server's", () => {
    expect(() => dayBounds("Not/AZone", new Date())).toThrow();
  });
});

describe("deriveStatus", () => {
  const bounds: DayBounds = {
    start: new Date("2026-09-10T00:00:00Z"),
    end: new Date("2026-09-11T00:00:00Z"),
  };

  it("calls a pending row due before today overdue", () => {
    expect(deriveStatus({ status: "PENDING", dueAt: new Date("2026-09-09T23:59:59Z") }, bounds))
      .toBe("OVERDUE");
  });

  it("calls a pending row due at exactly midnight today's", () => {
    expect(deriveStatus({ status: "PENDING", dueAt: new Date("2026-09-10T00:00:00Z") }, bounds))
      .toBe("TODAY");
  });

  it("calls a pending row due at the last second of the day today's", () => {
    expect(deriveStatus({ status: "PENDING", dueAt: new Date("2026-09-10T23:59:59Z") }, bounds))
      .toBe("TODAY");
  });

  it("calls a pending row due at tomorrow's midnight pending, not today's", () => {
    expect(deriveStatus({ status: "PENDING", dueAt: new Date("2026-09-11T00:00:00Z") }, bounds))
      .toBe("PENDING");
  });

  it("never re-labels a completed row, however old", () => {
    expect(deriveStatus({ status: "COMPLETED", dueAt: new Date("2020-01-01T00:00:00Z") }, bounds))
      .toBe("COMPLETED");
  });

  it("never re-labels a cancelled row as overdue", () => {
    expect(deriveStatus({ status: "CANCELLED", dueAt: new Date("2020-01-01T00:00:00Z") }, bounds))
      .toBe("CANCELLED");
  });
});

describe("statusClause", () => {
  const bounds: DayBounds = {
    start: new Date("2026-09-10T00:00:00Z"),
    end: new Date("2026-09-11T00:00:00Z"),
  };

  it("scopes overdue to pending rows before today", () => {
    expect(statusClause("OVERDUE", bounds)).toEqual({
      status: "PENDING",
      dueAt: { lt: bounds.start },
    });
  });

  it("scopes today to the half-open day", () => {
    expect(statusClause("TODAY", bounds)).toEqual({
      status: "PENDING",
      dueAt: { gte: bounds.start, lt: bounds.end },
    });
  });

  it("scopes pending to what is still upcoming", () => {
    expect(statusClause("PENDING", bounds)).toEqual({
      status: "PENDING",
      dueAt: { gte: bounds.end },
    });
  });

  it("passes stored states straight through", () => {
    expect(statusClause("COMPLETED", bounds)).toEqual({ status: "COMPLETED" });
    expect(statusClause("CANCELLED", bounds)).toEqual({ status: "CANCELLED" });
  });

  /**
   * The property that makes the filter bar's numbers add up. If any two of these three
   * overlapped, selecting each in turn would double-count rows against the total.
   */
  it("partitions the pending rows — the three derived states never overlap", () => {
    const day = 24 * 60 * 60 * 1000;
    const samples = [
      new Date(bounds.start.getTime() - day),
      new Date(bounds.start.getTime() - 1),
      bounds.start,
      new Date(bounds.end.getTime() - 1),
      bounds.end,
      new Date(bounds.end.getTime() + day),
    ];

    for (const dueAt of samples) {
      const matches = (["OVERDUE", "TODAY", "PENDING"] as const).filter((status) => {
        const clause = statusClause(status, bounds).dueAt as {
          lt?: Date;
          gte?: Date;
        };
        if (clause.gte && dueAt < clause.gte) return false;
        if (clause.lt && dueAt >= clause.lt) return false;
        return true;
      });
      expect(matches).toHaveLength(1);
    }
  });
});

describe("dueWindow", () => {
  const at = new Date("2026-09-10T12:00:00Z");

  it("returns nothing when no window was asked for", () => {
    expect(dueWindow(undefined, "UTC", at)).toBeNull();
  });

  it("makes tomorrow start where today ends, with no gap and no overlap", () => {
    const today = dueWindow("today", "UTC", at) as { lt: Date };
    const tomorrow = dueWindow("tomorrow", "UTC", at) as { gte: Date };
    expect(tomorrow.gte.getTime()).toBe(today.lt.getTime());
  });

  it("counts this week from today's midnight, seven days wide", () => {
    const week = dueWindow("week", "UTC", at) as { gte: Date; lt: Date };
    expect(week.gte.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(week.lt.toISOString()).toBe("2026-09-17T00:00:00.000Z");
  });

  it("puts past strictly before today, so nothing due today is called past", () => {
    const past = dueWindow("past", "UTC", at) as { lt: Date };
    expect(past.lt.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  /**
   * Seven sleeps, not 168 hours. A week that crosses a clock change is 167 or 169 hours
   * long, and a window built by multiplying a day would land an hour into the eighth day
   * or an hour short of the seventh.
   */
  it("counts a week in calendar days across a daylight-saving change", () => {
    const beforeSpringForward = new Date("2026-03-05T18:00:00Z");
    const week = dueWindow("week", "America/New_York", beforeSpringForward) as {
      gte: Date;
      lt: Date;
    };
    expect(week.gte.toISOString()).toBe("2026-03-05T05:00:00.000Z");
    expect(week.lt.toISOString()).toBe("2026-03-12T04:00:00.000Z");
    expect(week.lt.getTime() - week.gte.getTime()).toBe(167 * 60 * 60 * 1000);
  });

  it("keeps tomorrow one calendar day wide over a clock change", () => {
    const dayBefore = new Date("2026-03-07T18:00:00Z");
    const tomorrow = dueWindow("tomorrow", "America/New_York", dayBefore) as {
      gte: Date;
      lt: Date;
    };
    expect(tomorrow.gte.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(tomorrow.lt.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});
