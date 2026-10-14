import { SOURCE_TONE, discoveredLeads, popularSearches } from "./mock-discovery";

describe("Find Leads sample data", () => {
  it("never carries a full phone number", () => {
    for (const lead of discoveredLeads) {
      // Country code plus at most the last two digits: nothing anyone could dial.
      const digits = lead.phone.replace(/^\+\d{1,3}/, "").replace(/\D/g, "");
      expect(digits.length).toBeLessThanOrEqual(2);
      expect(lead.phone).toMatch(/•/);
    }
  });

  it("names no third-party data source", () => {
    const text = JSON.stringify({ discoveredLeads, popularSearches, SOURCE_TONE });
    expect(text).not.toMatch(/google|maps|justdial|practo|indiamart|linkedin|sulekha/i);
  });

  it("reads as sample data for any B2B vertical, not as named clinics and doctors", () => {
    for (const lead of discoveredLeads) {
      expect(lead.name).toMatch(/^Sample /);
      expect(lead.contactPerson).not.toMatch(/^Dr\.?\s/);
    }
    expect(JSON.stringify(discoveredLeads)).not.toMatch(/\b(clinics?|dental|hospitals?)\b/i);
  });
});
