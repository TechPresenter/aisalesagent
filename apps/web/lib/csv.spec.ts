import { CsvFormatError, IMPORT_FIELDS, guessMapping, parseCsv } from "./csv";

/**
 * The import uploads the rows this reader produces (lib/lead-import.ts re-writes them into
 * its batches), so a misreading here is a misimport, not a preview glitch. These pin the
 * two ways a stray quote mark used to go wrong: silently swallowing the rest of the file,
 * and silently mangling a value.
 */

describe("parseCsv", () => {
  it("reads quoted fields, escaped quotes and line breaks inside quotes", () => {
    const parsed = parseCsv(
      'Name,Phone,City\r\n"Acme, Inc.",9876543210,"Pune"\r\n"Say ""hi""\nthere",9876543211,Delhi\r\n',
    );

    expect(parsed.totalRows).toBe(2);
    expect(parsed.rows).toEqual([
      { Name: "Acme, Inc.", Phone: "9876543210", City: "Pune" },
      { Name: 'Say "hi"\nthere', Phone: "9876543211", City: "Delhi" },
    ]);
  });

  it("keeps a quote mark in the middle of an unquoted value as part of it", () => {
    const parsed = parseCsv(
      'Name,Phone,City\nA,9876543210,Pune 24" Road\nB,9876543211,Delhi\nC,9876543212,5\'11" Lane\n',
    );

    expect(parsed.totalRows).toBe(3);
    expect(parsed.rows.map((row) => row.City)).toEqual(['Pune 24" Road', "Delhi", '5\'11" Lane']);
  });

  it("allows spaces around a quoted value, as the server's trim does", () => {
    const parsed = parseCsv('Name,Phone\n  "Acme, Inc."  , 9876543210\n');

    expect(parsed.rows).toEqual([{ Name: "Acme, Inc.", Phone: "9876543210" }]);
  });

  it("refuses a quoted value that is never closed, naming the row it opens on", () => {
    const text = 'Name,Phone\nA,9876543210\n\nB,"9876543211\nC,9876543212\n';

    expect(() => parseCsv(text)).toThrow(CsvFormatError);
    try {
      parseCsv(text);
    } catch (error) {
      // The blank line is not counted, as the import report does not count it.
      expect((error as CsvFormatError).row).toBe(2);
      expect((error as CsvFormatError).message).toMatch(/^Row 2 has a quote mark .* never closed/);
    }
  });

  it("refuses text after a closing quote rather than reading on with the quotes out of step", () => {
    const text = 'Name,Phone,City\nA,9876543210,"Pune 24" Road"\nB,9876543211,Delhi\n';

    expect(() => parseCsv(text)).toThrow(CsvFormatError);
    try {
      parseCsv(text);
    } catch (error) {
      expect((error as CsvFormatError).row).toBe(1);
      expect((error as CsvFormatError).message).toMatch(/^Row 1 has text straight after/);
    }
  });

  it("names the header row when the problem is there", () => {
    expect(() => parseCsv('"Name,Phone\nA,9876543210\n')).toThrow(/^The header row has a quote/);
  });
});

describe("guessMapping", () => {
  it("offers only the fields the API stores on the lead itself", () => {
    expect(IMPORT_FIELDS.map((field) => field.key)).toEqual([
      "name",
      "phone",
      "city",
      "doNotCall",
      "consentCapturedAt",
    ]);
  });

  it("leaves contact person, email and address columns to keep their own headers", () => {
    const mapping = guessMapping([
      "Company Name",
      "Contact Person",
      "Email",
      "Mobile Number",
      "City",
      "Address",
      "DND",
    ]);

    expect(mapping).toEqual({
      name: "Company Name",
      phone: "Mobile Number",
      city: "City",
      doNotCall: "DND",
    });
  });

  it("claims a do-not-call or consent column only on an exact header", () => {
    expect(guessMapping(["Name", "Phone", "Do Not Call", "Consent Date"])).toMatchObject({
      doNotCall: "Do Not Call",
      consentCapturedAt: "Consent Date",
    });
    const loose = guessMapping(["Name", "Phone", "DND reason", "Date"]);
    expect(loose.doNotCall).toBeUndefined();
    expect(loose.consentCapturedAt).toBeUndefined();
  });

  it("labels the name field for any business, and still maps clinic-style headers", () => {
    const nameField = IMPORT_FIELDS.find((field) => field.key === "name");
    expect(nameField?.label).toBe("Lead / Company Name");
    expect(nameField?.label).not.toMatch(/clinic/i);

    expect(guessMapping(["Lead / Company Name", "Phone"]).name).toBe("Lead / Company Name");
    expect(guessMapping(["Lead / Clinic Name", "Phone"]).name).toBe("Lead / Clinic Name");
    expect(guessMapping(["Clinic", "Mobile"]).name).toBe("Clinic");
  });
});
