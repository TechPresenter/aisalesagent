import {
  applyColumnMapping,
  dedupeImportRows,
  normalisePhone,
  type ImportRow,
} from "./leads.dedupe";

/**
 * The de-duplication rule is "one lead per phone number per workspace", and everything
 * hard about it is deciding when two spellings are the same number. These tests are
 * mostly about that.
 */

describe("normalisePhone", () => {
  it("reduces every common spelling of one Indian mobile to the same value", () => {
    const spellings = [
      "+91 98765 43210",
      "+919876543210",
      "919876543210",
      "09876543210",
      "9876543210",
      "(+91) 98765-43210",
      "  +91-98765 43210  ",
      "0091 98765 43210",
    ];

    const normalised = spellings.map((spelling) => normalisePhone(spelling).value);

    // The point of the test: one distinct value, not eight leads for one clinic.
    expect(new Set(normalised).size).toBe(1);
    expect(normalised[0]).toBe("919876543210");
  });

  it("keeps a bare 10-digit mobile and a country-coded one together", () => {
    expect(normalisePhone("9876543210").value).toBe(normalisePhone("+91 9876543210").value);
  });

  it("does not confuse a country code with the first digits of a longer number", () => {
    // 12 digits starting 91 where the remainder is not a valid mobile (starts with 1)
    // is not "+91 followed by a mobile" — it is something else, and guessing is worse
    // than rejecting.
    expect(normalisePhone("911234567890").value).toBeNull();
  });

  it("rejects values that cannot be a phone number", () => {
    expect(normalisePhone("").value).toBeNull();
    expect(normalisePhone(null).value).toBeNull();
    expect(normalisePhone(undefined).value).toBeNull();
    expect(normalisePhone("not a number").value).toBeNull();
    expect(normalisePhone("12").value).toBeNull();
    expect(normalisePhone("1234567890123456789").value).toBeNull();
  });

  it("explains why a value was rejected", () => {
    expect(normalisePhone("12").reason).toMatch(/too short/);
    expect(normalisePhone("1234567890123456789").reason).toMatch(/too long/);
    expect(normalisePhone("").reason).toBe("empty");
  });

  it("keeps landlines and international numbers rather than discarding them", () => {
    // A clinic with a landline is still a clinic. An Indian landline written with its
    // trunk prefix — 0612 is Patna — comes out country-coded like a mobile does, which
    // is the same number in E.164 and so still de-duplicates correctly against itself.
    expect(normalisePhone("0612 2345678").value).toBe("916122345678");
    expect(normalisePhone("+91 612 2345678").value).toBe("916122345678");

    // A number that is not Indian at all is kept as its digits rather than being forced
    // under +91, which would silently corrupt it.
    expect(normalisePhone("+1 415 555 0132").value).toBe("14155550132");
  });
});

describe("dedupeImportRows", () => {
  const row = (name: string, phone: string, extra: Partial<ImportRow> = {}): ImportRow => ({
    name,
    phone,
    ...extra,
  });

  it("imports distinct leads untouched", () => {
    const result = dedupeImportRows(
      [row("Apex Dental", "9876543211"), row("Health Plus", "8765432123")],
      new Set(),
    );

    expect(result.toInsert).toHaveLength(2);
    expect(result.duplicatesInFile).toHaveLength(0);
    expect(result.duplicatesInDatabase).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("collapses differently-spelled duplicates within one file", () => {
    const result = dedupeImportRows(
      [
        row("Apex Dental Care", "+91 98765 43210"),
        row("Apex Dental", "09876543210"),
        row("APEX DENTAL CARE", "919876543210"),
      ],
      new Set(),
    );

    expect(result.toInsert).toHaveLength(1);
    expect(result.duplicatesInFile).toHaveLength(2);
  });

  it("keeps the first occurrence, not the last", () => {
    const result = dedupeImportRows(
      [row("First Spelling", "9876543210"), row("Second Spelling", "+919876543210")],
      new Set(),
    );

    expect(result.toInsert[0].name).toBe("First Spelling");
    expect(result.duplicatesInFile[0].sourceRow).toBe(2);
  });

  it("drops rows whose number the workspace already holds", () => {
    const result = dedupeImportRows(
      [row("Already Known", "+91 98765 43210"), row("Brand New", "8765432123")],
      new Set(["919876543210"]),
    );

    expect(result.toInsert.map((lead) => lead.name)).toEqual(["Brand New"]);
    expect(result.duplicatesInDatabase).toHaveLength(1);
    expect(result.duplicatesInDatabase[0].sourceRow).toBe(1);
  });

  it("separates the two kinds of duplicate, because they mean different things to a user", () => {
    // "Your file repeats itself" and "you already have this lead" call for different
    // fixes, so the summary must not merge them into one count.
    const result = dedupeImportRows(
      [row("In File Twice", "9876543210"), row("In File Twice", "09876543210"), row("Known", "8765432123")],
      new Set(["918765432123"]),
    );

    expect(result.duplicatesInFile).toHaveLength(1);
    expect(result.duplicatesInDatabase).toHaveLength(1);
    expect(result.toInsert).toHaveLength(1);
  });

  it("reports every repeat of an already-known number as already known", () => {
    // Precedence question, worth pinning down: when a file repeats a number the
    // workspace *already holds*, both rows are reported as "already exists" rather than
    // the second being demoted to "duplicate within file".
    //
    // Both readings are defensible, and this one is chosen because the two rows were
    // skipped for the same underlying reason and a user fixing the import should see one
    // problem, not two. Splitting them would make the summary imply that removing the
    // in-file repetition would let the second row through, which it would not.
    const result = dedupeImportRows(
      [row("Known", "9876543210"), row("Known Again", "09876543210"), row("New", "8765432123")],
      new Set(["919876543210"]),
    );

    expect(result.duplicatesInDatabase).toHaveLength(2);
    expect(result.duplicatesInFile).toHaveLength(0);
    expect(result.toInsert.map((lead) => lead.name)).toEqual(["New"]);
  });

  it("rejects unusable rows and reports the row number", () => {
    const result = dedupeImportRows(
      [row("", "9876543210"), row("No Phone", ""), row("Bad Phone", "abc"), row("Fine", "8765432123")],
      new Set(),
    );

    expect(result.toInsert).toHaveLength(1);
    expect(result.rejected.map((r) => r.sourceRow)).toEqual([1, 2, 3]);
    expect(result.rejected[0].reason).toBe("missing name");
    expect(result.rejected[2].reason).toMatch(/invalid phone/);
  });

  it("accounts for every input row exactly once", () => {
    // A summary that does not add up is worse than no summary — the user cannot tell
    // whether a row was imported, skipped or silently lost.
    const rows = [
      row("A", "9876543210"),
      row("A again", "09876543210"),
      row("B", "8765432123"),
      row("Existing", "7654321234"),
      row("", "6543212345"),
      row("Bad", "xyz"),
    ];

    const result = dedupeImportRows(rows, new Set(["917654321234"]));

    const accounted =
      result.toInsert.length +
      result.duplicatesInFile.length +
      result.duplicatesInDatabase.length +
      result.rejected.length;

    expect(accounted).toBe(rows.length);
  });

  it("normalises the number it stores, not the one it was given", () => {
    const result = dedupeImportRows([row("Apex", "+91 98765 43210")], new Set());
    expect(result.toInsert[0].phone).toBe("919876543210");
  });

  it("trims names and treats a whitespace-only name as missing", () => {
    const result = dedupeImportRows(
      [row("  Apex Dental  ", "9876543210"), row("   ", "8765432123")],
      new Set(),
    );

    expect(result.toInsert[0].name).toBe("Apex Dental");
    expect(result.rejected[0].reason).toBe("missing name");
  });

  it("preserves unmapped columns into custom_fields instead of dropping them", () => {
    const result = dedupeImportRows(
      [row("Apex", "9876543210", { "Chair Count": "4", Speciality: "Ortho", city: "Patna" })],
      new Set(),
    );

    expect(result.toInsert[0].city).toBe("Patna");
    expect(result.toInsert[0].customFields).toEqual({ "Chair Count": "4", Speciality: "Ortho" });
  });

  it("leaves custom_fields null when there is nothing extra", () => {
    const result = dedupeImportRows([row("Apex", "9876543210", { city: "Patna" })], new Set());
    expect(result.toInsert[0].customFields).toBeNull();
  });

  it("handles an empty file", () => {
    const result = dedupeImportRows([], new Set());
    expect(result.toInsert).toHaveLength(0);
  });
});

describe("applyColumnMapping", () => {
  it("renames the mapped columns and keeps the rest", () => {
    const records = [{ "Clinic Name": "Apex Dental", Mobile: "9876543210", Notes: "Referred" }];
    const rows = applyColumnMapping(records, { name: "Clinic Name", phone: "Mobile" });

    expect(rows[0].name).toBe("Apex Dental");
    expect(rows[0].phone).toBe("9876543210");
    // Unmapped, so it survives under its own header and lands in custom_fields later.
    expect(rows[0].Notes).toBe("Referred");
  });

  it("ignores a mapping that points at a column the file does not have", () => {
    const rows = applyColumnMapping([{ Mobile: "9876543210" }], {
      name: "Clinic Name",
      phone: "Mobile",
    });

    expect(rows[0].name).toBeUndefined();
    expect(rows[0].phone).toBe("9876543210");
  });

  it("ignores blank mappings from an untouched dropdown", () => {
    const rows = applyColumnMapping([{ Mobile: "9876543210", City: "Patna" }], {
      phone: "Mobile",
      city: "",
    });

    expect(rows[0].phone).toBe("9876543210");
    expect(rows[0].City).toBe("Patna");
  });

  it("round-trips through dedupe with a realistically messy file", () => {
    const records = [
      { "Clinic Name": "Apex Dental Care", Mobile: "+91 98765 43210", Town: "Patna" },
      { "Clinic Name": "Apex Dental", Mobile: "09876543210", Town: "Patna" },
      { "Clinic Name": "Health Plus", Mobile: "8765432123", Town: "Gaya" },
    ];

    const rows = applyColumnMapping(records, {
      name: "Clinic Name",
      phone: "Mobile",
      city: "Town",
    });
    const result = dedupeImportRows(rows, new Set());

    expect(result.toInsert).toHaveLength(2);
    expect(result.duplicatesInFile).toHaveLength(1);
    expect(result.toInsert[0].city).toBe("Patna");
  });
});
