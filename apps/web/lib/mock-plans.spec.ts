import { MAX_RECORDING_RETENTION_DAYS, compareRows, plans, priceFor } from "./mock-plans";

/** Every customer-facing string a plan carries, flattened for copy checks. */
function planCopy(): string[] {
  return [
    ...plans.flatMap((plan) => [
      plan.name,
      plan.tagline,
      plan.cta,
      plan.bestFor,
      ...plan.features.map((feature) => feature.label),
    ]),
    ...compareRows.flatMap((row) => [
      row.feature,
      ...row.values.filter((value): value is string => typeof value === "string"),
    ]),
  ];
}

describe("plan catalogue", () => {
  it("keeps call recordings for a finite number of days on every plan", () => {
    const row = compareRows.find((r) => r.feature === "Call Recordings");
    expect(row).toBeDefined();
    for (const value of row!.values) {
      expect(typeof value).toBe("string");
      const days = Number(/(\d+) days/.exec(value as string)?.[1]);
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(MAX_RECORDING_RETENTION_DAYS);
    }
    const recordingLabels = plans
      .flatMap((plan) => plan.features.map((feature) => feature.label))
      .filter((label) => /recording/i.test(label));
    for (const label of recordingLabels) expect(label).toMatch(/\d+ days/);
  });

  it("promises no unlimited calls on a credit-metered product", () => {
    const calls = compareRows.find((r) => r.feature === "AI Calls per Month");
    expect(calls?.values).not.toContain("Unlimited");
    for (const plan of plans) {
      for (const feature of plan.features) expect(feature.label).not.toMatch(/unlimited/i);
    }
  });

  it("names no single vertical, since the product is sold to any B2B team", () => {
    for (const text of planCopy()) {
      expect(text).not.toMatch(/\b(clinics?|healthcare|hospitals?|dental|EMR|HIS)\b/i);
    }
  });

  it("derives the yearly price from the monthly one", () => {
    const starter = plans.find((plan) => plan.id === "starter")!;
    expect(priceFor(starter, "monthly")).toBe(starter.monthlyPrice);
    expect(priceFor(starter, "yearly")).toBe(Math.round(starter.monthlyPrice! * 0.8));
    expect(
      priceFor(
        plans.find((plan) => plan.id === "enterprise")!,
        "yearly",
      ),
    ).toBeNull();
  });
});
