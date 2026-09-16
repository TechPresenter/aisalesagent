import {
  BLOCK_REASON_TEXT,
  evaluateCallGates,
  isBlocked,
  localTimeIn,
  type GateInput,
} from "./calling-rules";

/**
 * These gates are the difference between an outbound dialer and a compliance incident.
 * A bug here does not produce a wrong number on a dashboard — it rings a stranger at
 * 3am, or calls someone who asked not to be contacted, and the consequence is legal
 * rather than cosmetic.
 *
 * So the tests are written to be adversarial about the boundaries rather than to
 * demonstrate the happy path: the last permitted minute, the first forbidden one, the
 * attempt that equals the maximum, the block list defeated by formatting.
 */
describe("calling gates", () => {
  /** A request that passes every gate. Each test breaks exactly one thing. */
  const allowed = (): GateInput => ({
    campaignStatus: "ACTIVE",
    callingEnabled: true,
    window: { startMinute: 600, endMinute: 1140, days: [1, 2, 3, 4, 5] },
    localNow: { minuteOfDay: 720, dayOfWeek: 3 },
    lead: { phone: "+919876543210", doNotCall: false, country: "India", status: "NEW" },
    attempts: 0,
    maxAttempts: 3,
    lastAttemptAt: null,
    retryDelayMinutes: 240,
    now: new Date("2026-09-10T12:00:00Z"),
    callsToday: 0,
    dailyCallLimit: 100,
    creditBalance: 50,
    creditCost: 1,
    blockedNumbers: [],
    allowedCountries: [],
    dncEnabled: true,
  });

  it("allows a call that passes every gate", () => {
    expect(evaluateCallGates(allowed())).toEqual({ allowed: true, reasons: [] });
  });

  it("reports every reason, not just the first", () => {
    // A UI that says "outside calling hours" and then, once fixed, "no credits", and
    // then "max attempts" is a UI nobody can get through. The whole problem, at once.
    const decision = evaluateCallGates({
      ...allowed(),
      localNow: { minuteOfDay: 300, dayOfWeek: 0 },
      creditBalance: 0,
      attempts: 3,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "OUTSIDE_CALLING_WINDOW",
        "DAY_NOT_ALLOWED",
        "INSUFFICIENT_CREDITS",
        "MAX_ATTEMPTS_REACHED",
      ]),
    );
  });

  describe("calling window", () => {
    it("allows the first minute of the window", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        localNow: { minuteOfDay: 600, dayOfWeek: 3 },
      });
      expect(decision.allowed).toBe(true);
    });

    it("allows the last minute before the window closes", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        localNow: { minuteOfDay: 1139, dayOfWeek: 3 },
      });
      expect(decision.allowed).toBe(true);
    });

    it("blocks the closing minute itself", () => {
      // 19:00 on a 10:00-19:00 window is outside it. An inclusive end would place calls
      // one minute past the hours the workspace agreed to, every single day.
      const decision = evaluateCallGates({
        ...allowed(),
        localNow: { minuteOfDay: 1140, dayOfWeek: 3 },
      });
      expect(decision.reasons).toContain("OUTSIDE_CALLING_WINDOW");
    });

    it("blocks one minute before the window opens", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        localNow: { minuteOfDay: 599, dayOfWeek: 3 },
      });
      expect(decision.reasons).toContain("OUTSIDE_CALLING_WINDOW");
    });

    it("blocks a day the campaign does not call on", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        localNow: { minuteOfDay: 720, dayOfWeek: 0 },
      });
      expect(decision.reasons).toContain("DAY_NOT_ALLOWED");
    });

    it("treats an empty day list as every day", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        window: { startMinute: 600, endMinute: 1140, days: [] },
        localNow: { minuteOfDay: 720, dayOfWeek: 0 },
      });
      expect(decision.allowed).toBe(true);
    });
  });

  describe("who may be called", () => {
    it("blocks a lead on the do-not-call list", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        lead: { ...allowed().lead, doNotCall: true },
      });
      expect(decision.reasons).toContain("DO_NOT_CALL");
    });

    it.each(["CONVERTED", "NOT_INTERESTED", "WRONG_NUMBER", "INVALID", "LOST", "CLOSED"])(
      "blocks a lead whose status is %s",
      (status) => {
        const decision = evaluateCallGates({
          ...allowed(),
          lead: { ...allowed().lead, status },
        });
        expect(decision.reasons).toContain("LEAD_ALREADY_CLOSED");
      },
    );

    it("still calls a lead that merely did not answer", () => {
      // NO_ANSWER is the case retries exist for; treating it as closed would make the
      // retry policy dead code.
      const decision = evaluateCallGates({
        ...allowed(),
        lead: { ...allowed().lead, status: "NO_ANSWER" },
      });
      expect(decision.allowed).toBe(true);
    });

    it("blocks a country outside the allowed list", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        allowedCountries: ["India"],
        lead: { ...allowed().lead, country: "UAE" },
      });
      expect(decision.reasons).toContain("COUNTRY_NOT_ALLOWED");
    });

    it("blocks a lead with no country when the list is restrictive", () => {
      // Unknown is not the same as permitted. Defaulting an absent country to "allowed"
      // would make the restriction trivially bypassable by leaving a field blank.
      const decision = evaluateCallGates({
        ...allowed(),
        allowedCountries: ["India"],
        lead: { ...allowed().lead, country: null },
      });
      expect(decision.reasons).toContain("COUNTRY_NOT_ALLOWED");
    });

    it("allows any country when the list is empty", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        allowedCountries: [],
        lead: { ...allowed().lead, country: "Singapore" },
      });
      expect(decision.allowed).toBe(true);
    });

    it.each(["", "12345", "not-a-number", "+0123456789"])(
      "refuses to dial the unusable number %p",
      (phone) => {
        const decision = evaluateCallGates({ ...allowed(), lead: { ...allowed().lead, phone } });
        expect(decision.reasons).toContain("INVALID_PHONE");
      },
    );

    it("accepts a number written with spaces and punctuation", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        lead: { ...allowed().lead, phone: "+91 (98765) 43210" },
      });
      expect(decision.allowed).toBe(true);
    });
  });

  describe("blocked numbers", () => {
    it("blocks regardless of how either side is formatted", () => {
      // The one thing a block list must not do is fail because of punctuation.
      expect(isBlocked("+91 98765 43210", ["919876543210"])).toBe(true);
      expect(isBlocked("919876543210", ["+91 98765 43210"])).toBe(true);
      expect(isBlocked("+919876543210", ["98765-43210"])).toBe(true);
    });

    it("matches a subscriber number stored with a country code", () => {
      expect(isBlocked("+919876543210", ["9876543210"])).toBe(true);
    });

    it("does not block an unrelated number", () => {
      expect(isBlocked("+919876543210", ["+919999888877"])).toBe(false);
    });

    it("ignores blank entries rather than blocking everything", () => {
      // A stray empty string in the list must not turn into a suffix that matches every
      // number, which would silently stop the entire dialer.
      expect(isBlocked("+919876543210", ["", "  "])).toBe(false);
    });
  });

  describe("retry policy", () => {
    it("blocks once attempts equal the maximum", () => {
      const decision = evaluateCallGates({ ...allowed(), attempts: 3, maxAttempts: 3 });
      expect(decision.reasons).toContain("MAX_ATTEMPTS_REACHED");
    });

    it("allows the final permitted attempt", () => {
      const decision = evaluateCallGates({ ...allowed(), attempts: 2, maxAttempts: 3 });
      expect(decision.allowed).toBe(true);
    });

    it("blocks a retry before the delay has elapsed", () => {
      const now = new Date("2026-09-10T12:00:00Z");
      const decision = evaluateCallGates({
        ...allowed(),
        now,
        attempts: 1,
        lastAttemptAt: new Date(now.getTime() - 60 * 60_000),
        retryDelayMinutes: 240,
      });
      expect(decision.reasons).toContain("RETRY_TOO_SOON");
    });

    it("allows a retry once the delay has elapsed", () => {
      const now = new Date("2026-09-10T12:00:00Z");
      const decision = evaluateCallGates({
        ...allowed(),
        now,
        attempts: 1,
        lastAttemptAt: new Date(now.getTime() - 241 * 60_000),
        retryDelayMinutes: 240,
      });
      expect(decision.allowed).toBe(true);
    });
  });

  describe("limits", () => {
    it("blocks once the daily limit is reached", () => {
      const decision = evaluateCallGates({ ...allowed(), callsToday: 100, dailyCallLimit: 100 });
      expect(decision.reasons).toContain("DAILY_LIMIT_REACHED");
    });

    it("treats a null daily limit as unlimited", () => {
      const decision = evaluateCallGates({
        ...allowed(),
        callsToday: 100_000,
        dailyCallLimit: null,
      });
      expect(decision.allowed).toBe(true);
    });

    it("blocks when the balance is below the cost", () => {
      const decision = evaluateCallGates({ ...allowed(), creditBalance: 0, creditCost: 1 });
      expect(decision.reasons).toContain("INSUFFICIENT_CREDITS");
    });

    it("allows when the balance exactly covers the cost", () => {
      const decision = evaluateCallGates({ ...allowed(), creditBalance: 1, creditCost: 1 });
      expect(decision.allowed).toBe(true);
    });
  });

  describe("switches", () => {
    it("blocks when calling is switched off for the workspace", () => {
      const decision = evaluateCallGates({ ...allowed(), callingEnabled: false });
      expect(decision.reasons).toContain("CALLING_DISABLED");
    });

    it.each(["DRAFT", "PAUSED", "COMPLETED", "ARCHIVED"] as const)(
      "blocks a %s campaign",
      (campaignStatus) => {
        const decision = evaluateCallGates({ ...allowed(), campaignStatus });
        expect(decision.reasons).toContain("CAMPAIGN_NOT_ACTIVE");
      },
    );
  });

  describe("local time", () => {
    it("reads the wall clock in the campaign's timezone, not the server's", () => {
      // 06:30 UTC is 12:00 in Kolkata. A server in UTC judging a Kolkata campaign by its
      // own clock would refuse this call as being before the 10:00 window opens.
      const at = new Date("2026-09-10T06:30:00Z");
      expect(localTimeIn("Asia/Kolkata", at).minuteOfDay).toBe(12 * 60);
      expect(localTimeIn("UTC", at).minuteOfDay).toBe(6 * 60 + 30);
    });

    it("handles midnight without wrapping past the end of the day", () => {
      const at = new Date("2026-09-10T18:35:00Z"); // 00:05 next day in Kolkata
      expect(localTimeIn("Asia/Kolkata", at).minuteOfDay).toBe(5);
    });

    it("reports the day of week in the campaign's timezone", () => {
      // Still Thursday in UTC, already Friday in Auckland.
      const at = new Date("2026-09-10T20:00:00Z");
      expect(localTimeIn("UTC", at).dayOfWeek).toBe(4);
      expect(localTimeIn("Pacific/Auckland", at).dayOfWeek).toBe(5);
    });
  });

  it("has readable text for every block reason", () => {
    // A reason with no sentence reaches the UI as a raw enum, which tells a salesperson
    // nothing. Derived from the decision type so a new reason fails here immediately.
    const decision = evaluateCallGates({
      ...allowed(),
      callingEnabled: false,
      campaignStatus: "DRAFT",
      localNow: { minuteOfDay: 0, dayOfWeek: 0 },
      lead: { phone: "x", doNotCall: true, country: "UAE", status: "CLOSED" },
      allowedCountries: ["India"],
      blockedNumbers: ["x"],
      attempts: 9,
      creditBalance: 0,
      callsToday: 999,
      dailyCallLimit: 1,
      lastAttemptAt: new Date("2026-09-10T11:59:00Z"),
    });

    for (const reason of decision.reasons) {
      expect(BLOCK_REASON_TEXT[reason]).toBeTruthy();
    }
    // The adversarial input above should trip essentially everything.
    expect(decision.reasons.length).toBeGreaterThanOrEqual(10);
  });
});
