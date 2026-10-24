import { readCreditPolicy, trialEndsAt } from "./credit-policy";

/**
 * These numbers decide how many credits exist without anyone paying for them, so the
 * parsing is strict on purpose: anything that is not plainly a whole number stops the
 * boot instead of being read as something else.
 */
describe("credit policy", () => {
  it("defaults to no free credits, no trial expiry and a modest operator cap", () => {
    expect(readCreditPolicy({})).toEqual({
      trialCredits: 0,
      trialDays: 0,
      operatorDailyGrantCap: 10_000,
    });
  });

  it("treats a blank value as unset", () => {
    expect(readCreditPolicy({ TRIAL_CREDITS: "  ", TRIAL_DAYS: "" })).toMatchObject({
      trialCredits: 0,
      trialDays: 0,
    });
  });

  it("reads whole numbers", () => {
    expect(
      readCreditPolicy({ TRIAL_CREDITS: "100", TRIAL_DAYS: " 14 ", OPERATOR_DAILY_CREDIT_CAP: "0" }),
    ).toEqual({ trialCredits: 100, trialDays: 14, operatorDailyGrantCap: 0 });
  });

  it.each(["-1", "1e3", "100.5", "ten", "0x10", "1000001"])(
    "refuses TRIAL_CREDITS=%s rather than guessing",
    (value) => {
      expect(() => readCreditPolicy({ TRIAL_CREDITS: value })).toThrow(/TRIAL_CREDITS must be a whole number/);
    },
  );

  it("puts the end of a trial TRIAL_DAYS after it starts, or nowhere", () => {
    const start = new Date("2026-10-14T00:00:00.000Z");
    expect(trialEndsAt({ trialDays: 0 }, start)).toBeNull();
    expect(trialEndsAt({ trialDays: 14 }, start)?.toISOString()).toBe("2026-10-28T00:00:00.000Z");
  });
});
