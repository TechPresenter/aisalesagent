import {
  applyColumnMapping,
  dedupeImportRows,
  isDoNotCallHeader,
  normalisePhone,
  parseConsentDate,
  parseDoNotCall,
  suppressionCandidates,
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
      row("Opted out", "6987654321"),
      row("", "6543212345"),
      row("Bad", "xyz"),
      row("Bad DND", "6123456789", { doNotCall: "perhaps" }),
    ];

    const result = dedupeImportRows(rows, new Set(["917654321234"]), new Set(["916987654321"]));

    const accounted =
      result.toInsert.length +
      result.duplicatesInFile.length +
      result.duplicatesInDatabase.length +
      result.suppressed.length +
      result.rejected.length;

    expect(accounted).toBe(rows.length);
    expect(result.suppressed).toHaveLength(1);
  });

  it("skips and reports numbers on the do-not-call list", () => {
    const result = dedupeImportRows(
      [row("Opted Out", "+91 98765 43210"), row("Fine", "8765432123")],
      new Set(),
      new Set(["919876543210"]),
    );

    expect(result.toInsert.map((lead) => lead.name)).toEqual(["Fine"]);
    expect(result.suppressed).toEqual([
      {
        sourceRow: 1,
        reason: "number is on this workspace's do-not-call list",
        value: "919876543210",
      },
    ]);
  });

  it("reports a suppressed number as suppressed even when it is also an existing lead", () => {
    // "This person asked not to be called" is the fact a preview should lead with.
    const result = dedupeImportRows(
      [row("Both", "9876543210")],
      new Set(["919876543210"]),
      new Set(["919876543210"]),
    );

    expect(result.suppressed).toHaveLength(1);
    expect(result.duplicatesInDatabase).toHaveLength(0);
  });

  it("carries a do-not-call column onto the lead and lists the number for suppression", () => {
    const result = dedupeImportRows(
      [
        row("Opted Out", "9876543210", { doNotCall: "Yes" }),
        row("Callable", "8765432123", { doNotCall: "no" }),
        row("Blank", "7654321234", { doNotCall: "" }),
      ],
      new Set(),
    );

    expect(result.toInsert.map((lead) => [lead.name, lead.doNotCall])).toEqual([
      ["Opted Out", true],
      ["Callable", false],
      ["Blank", false],
    ]);
    expect(result.doNotCallPhones).toEqual(["919876543210"]);
    // Claimed by the lead itself, so it does not also land in custom_fields.
    expect(result.toInsert[0].customFields).toBeNull();
  });

  it("honours an opt-out on a row that is skipped as a duplicate", () => {
    // The lead is not imported, but the file is still saying this person must not be
    // called — so the number is listed for suppression all the same.
    const result = dedupeImportRows(
      [row("First", "9876543210"), row("Second", "09876543210", { doNotCall: "DND" })],
      new Set(["918765432123"]),
    );
    const existing = dedupeImportRows(
      [row("Known", "8765432123", { doNotCall: "true" })],
      new Set(["918765432123"]),
    );

    expect(result.duplicatesInFile).toHaveLength(1);
    expect(result.doNotCallPhones).toEqual(["919876543210"]);
    expect(existing.duplicatesInDatabase).toHaveLength(1);
    expect(existing.doNotCallPhones).toEqual(["918765432123"]);
  });

  it("rejects a do-not-call value it cannot read rather than guessing", () => {
    const result = dedupeImportRows(
      [row("Unclear", "9876543210", { doNotCall: "maybe" })],
      new Set(),
    );

    expect(result.toInsert).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({ sourceRow: 1, value: "maybe" });
    expect(result.rejected[0].reason).toMatch(/do-not-call/);
  });

  it("reads an ISO consent date and rejects every other spelling", () => {
    const result = dedupeImportRows(
      [
        row("Dated", "9876543210", { consentCapturedAt: "2026-03-14" }),
        row("Undated", "8765432123"),
        row("Ambiguous", "7654321234", { consentCapturedAt: "05/10/2026" }),
        row("Impossible", "6543212345", { consentCapturedAt: "2026-02-30" }),
        row("Future", "6123456789", { consentCapturedAt: "2999-01-01" }),
      ],
      new Set(),
    );

    expect(result.toInsert.map((lead) => lead.consentCapturedAt?.toISOString() ?? null)).toEqual([
      "2026-03-14T00:00:00.000Z",
      null,
    ]);
    expect(result.rejected.map((r) => [r.sourceRow, r.reason])).toEqual([
      [3, "consent date must be a real date written YYYY-MM-DD"],
      [4, "consent date must be a real date written YYYY-MM-DD"],
      [5, "consent date is in the future"],
    ]);
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

  it("picks up a do-not-call column nobody mapped", () => {
    // An opt-out a CRM export carried must not land in custom_fields and leave the person
    // callable just because the uploader did not think to map it.
    const rows = applyColumnMapping(
      [{ Company: "Apex", Mobile: "9876543210", "Do Not Call": "Y" }],
      { name: "Company", phone: "Mobile" },
    );

    expect(rows[0].doNotCall).toBe("Y");
    expect(rows[0]["Do Not Call"]).toBeUndefined();
  });

  it("prefers an explicit do-not-call mapping to a guessed one", () => {
    const rows = applyColumnMapping(
      [{ Company: "Apex", Mobile: "9876543210", DND: "no", "Opted out": "yes" }],
      { name: "Company", phone: "Mobile", doNotCall: "Opted out" },
    );

    expect(rows[0].doNotCall).toBe("yes");
    expect(rows[0].DND).toBe("no");
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

describe("parseDoNotCall", () => {
  it("reads the spellings spreadsheets use", () => {
    for (const yes of ["yes", "Y", "TRUE", "1", "dnd", "DNC", "x", "Do Not Call", "do_not_call"]) {
      expect(parseDoNotCall(yes)).toBe(true);
    }
    for (const no of ["no", "N", "false", "0", "", "  ", undefined, null]) {
      expect(parseDoNotCall(no)).toBe(false);
    }
  });

  it("returns null for anything else, so the row is sent back rather than guessed at", () => {
    expect(parseDoNotCall("maybe")).toBeNull();
    expect(parseDoNotCall("call later")).toBeNull();
  });
});

describe("parseConsentDate", () => {
  it("accepts ISO dates and date-times", () => {
    expect(parseConsentDate("2026-03-14")?.toISOString()).toBe("2026-03-14T00:00:00.000Z");
    expect(parseConsentDate("2026-03-14T10:30:00+05:30")?.toISOString()).toBe(
      "2026-03-14T05:00:00.000Z",
    );
  });

  it("treats a blank cell as no date at all", () => {
    expect(parseConsentDate("")).toBeNull();
    expect(parseConsentDate(undefined)).toBeNull();
  });

  it("refuses the day-month order JavaScript would silently misread", () => {
    expect(parseConsentDate("05/10/2026")).toBeUndefined();
    expect(parseConsentDate("14-03-2026")).toBeUndefined();
  });

  it("refuses a date that is not on the calendar instead of rolling it over", () => {
    expect(parseConsentDate("2026-02-30")).toBeUndefined();
    expect(parseConsentDate("2026-13-01")).toBeUndefined();
    expect(parseConsentDate("2028-02-29")?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
});

describe("isDoNotCallHeader", () => {
  it("recognises the usual headers for a do-not-call column", () => {
    const headers = ["DND", "dnc", "Do Not Call", "do_not_call", "do-not-call", " DoNotCall "];
    for (const header of headers) {
      expect(isDoNotCallHeader(header)).toBe(true);
    }
  });

  it("leaves other columns alone", () => {
    for (const header of ["Notes", "Called", "Do call", "Status"]) {
      expect(isDoNotCallHeader(header)).toBe(false);
    }
  });
});

describe("suppressionCandidates", () => {
  /** What the gate's query would find among `stored`, done in memory. */
  const blocks = (phone: string, stored: string[]) => {
    const { equals, endingWith } = suppressionCandidates(phone);
    return stored.filter(
      (entry) => equals.includes(entry) || (endingWith !== null && entry.endsWith(endingWith)),
    );
  };

  it("matches an Indian mobile by its one normalised spelling and nothing else", () => {
    expect(suppressionCandidates("919876543210")).toEqual({
      equals: ["919876543210"],
      endingWith: null,
    });
    // A shorter entry that happens to end the number is some other number, or a typo.
    expect(blocks("919876543210", ["9876543210", "76543210", "919876543210"])).toEqual([
      "919876543210",
    ]);
  });

  it("matches an international number with or without its country code, either way round", () => {
    // Blocked as "+1 415 555 0100", lead typed as "415-555-0100".
    expect(blocks("4155550100", ["14155550100"])).toEqual(["14155550100"]);
    // Blocked as "415-555-0100", lead typed as "+1 415 555 0100".
    expect(blocks("14155550100", ["4155550100"])).toEqual(["4155550100"]);
    expect(blocks("14155550100", ["14155550199", "4155550199"])).toEqual([]);
  });

  it("never tries a suffix shorter than a phone number can be", () => {
    const { equals } = suppressionCandidates("14155550100");
    expect(equals).toEqual(["14155550100", "4155550100", "155550100", "55550100"]);
    expect(blocks("14155550100", ["5550100", "0100"])).toEqual([]);
  });
});
