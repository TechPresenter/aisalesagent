import { csvCell } from "./leads.service";

/**
 * The export's cell writer. A lead's name is whatever someone typed into a form or a
 * spreadsheet, and the export is opened in a spreadsheet — so the two things that matter
 * are that every value survives the round trip and that none of them runs as a formula.
 */
describe("csvCell", () => {
  it("writes plain values as they are", () => {
    expect(csvCell("Apex Dental")).toBe("Apex Dental");
    expect(csvCell(42)).toBe("42");
    expect(csvCell("919876543210")).toBe("919876543210");
  });

  it("writes nothing for a missing value", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes values holding a comma, a quote or a line break", () => {
    expect(csvCell("Patna, Bihar")).toBe('"Patna, Bihar"');
    expect(csvCell('The "Best" Clinic')).toBe('"The ""Best"" Clinic"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("defuses anything a spreadsheet would run as a formula", () => {
    expect(csvCell('=HYPERLINK("http://evil.example","x")')).toBe(
      `"'=HYPERLINK(""http://evil.example"",""x"")"`,
    );
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tTabbed")).toBe("'\tTabbed");
  });

  it("writes dates as ISO 8601 and objects as JSON", () => {
    expect(csvCell(new Date("2026-03-14T05:00:00.000Z"))).toBe("2026-03-14T05:00:00.000Z");
    expect(csvCell({ Speciality: "Ortho" })).toBe('"{""Speciality"":""Ortho""}"');
  });

  it("leaves Devanagari and other non-Latin text alone", () => {
    expect(csvCell("आशा वर्मा")).toBe("आशा वर्मा");
  });
});
