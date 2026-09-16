/**
 * De-duplication for `POST /leads/import`.
 *
 * The rule is "one lead per phone number per workspace", and the whole difficulty is in
 * the word "per phone number": a CSV exported from a clinic's own records will spell the
 * same Indian mobile five different ways —
 *
 *     +91 98765 43210    919876543210    098765-43210
 *     (+91) 9876543210   9876543210
 *
 * — and a naive string comparison imports five leads and calls the same person five
 * times. Normalisation is therefore the de-duplication; the rest is bookkeeping.
 *
 * Kept free of Nest and Prisma so it can be unit-tested directly, which is where the
 * interesting cases live.
 */

/** India is the launch market (TRD §3), so +91 is the default country code. */
export const DEFAULT_COUNTRY_CODE = "91";

/** Indian mobile numbers are 10 digits and never begin with 0–5. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export interface NormalisedPhone {
  /** E.164 without the leading "+", e.g. "919876543210". Null when unusable. */
  value: string | null;
  reason?: string;
}

/**
 * Reduces the spellings above to one canonical form.
 *
 * Order matters here. Stripping non-digits first turns "(+91) 98765-43210" and
 * "+919876543210" into the same digit string, and only then is it meaningful to ask
 * whether a leading 91 is a country code or the first two digits of a local number —
 * which is why the length checks come after, not before.
 */
export function normalisePhone(raw: string | null | undefined): NormalisedPhone {
  if (!raw) return { value: null, reason: "empty" };

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return { value: null, reason: "no digits" };

  // A single leading 0 is the Indian trunk prefix — "09876543210" is a 10-digit mobile
  // dialled domestically, not an 11-digit number.
  const withoutTrunk = digits.replace(/^0+/, "");

  if (INDIAN_MOBILE.test(withoutTrunk)) {
    return { value: DEFAULT_COUNTRY_CODE + withoutTrunk };
  }

  // Already carries the country code: 12 digits starting 91, with a valid mobile after.
  if (withoutTrunk.length === 12 && withoutTrunk.startsWith(DEFAULT_COUNTRY_CODE)) {
    const local = withoutTrunk.slice(2);
    if (INDIAN_MOBILE.test(local)) {
      return { value: withoutTrunk };
    }
    return { value: null, reason: "not a valid Indian mobile number" };
  }

  // Anything else is either a landline, an international number or a typo. Kept rather
  // than discarded — a landline is a real clinic — but only when it is long enough to be
  // a phone number at all, so a stray "12" in a spreadsheet column does not become a lead.
  if (withoutTrunk.length >= 8 && withoutTrunk.length <= 15) {
    return { value: withoutTrunk };
  }

  return {
    value: null,
    reason: withoutTrunk.length < 8 ? "too short to be a phone number" : "too long to be a phone number",
  };
}

export interface ImportRow {
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  [key: string]: unknown;
}

export interface PreparedLead {
  name: string;
  phone: string;
  city: string | null;
  customFields: Record<string, unknown> | null;
  /** 1-based row number in the uploaded file, for error reporting. */
  sourceRow: number;
}

export interface RejectedRow {
  sourceRow: number;
  reason: string;
  /** The raw value that could not be used, echoed back so the user can find it. */
  value?: string;
}

export interface DedupeResult {
  /** Rows that survived: unique within the file and not already in the workspace. */
  toInsert: PreparedLead[];
  /** Rows dropped because an earlier row in the same file had the same number. */
  duplicatesInFile: RejectedRow[];
  /** Rows dropped because the workspace already holds that number. */
  duplicatesInDatabase: RejectedRow[];
  /** Rows dropped because they were unusable — no name, no parseable phone. */
  rejected: RejectedRow[];
}

/**
 * Decides what an import should actually insert.
 *
 * `existingPhones` is the set of normalised numbers the workspace already holds. Passing
 * it in rather than querying inside keeps this function pure and testable, and lets the
 * caller fetch them in one query instead of one per row.
 *
 * Within-file duplicates keep the *first* occurrence. That is the one choice here a
 * reader might expect to go the other way: last-wins would let a corrected row later in
 * the file override an earlier one. First-wins is chosen because import files are
 * usually concatenations of exports, where the earlier rows are the older, more
 * complete records and the later ones are partial re-exports.
 */
export function dedupeImportRows(rows: ImportRow[], existingPhones: Set<string>): DedupeResult {
  const result: DedupeResult = {
    toInsert: [],
    duplicatesInFile: [],
    duplicatesInDatabase: [],
    rejected: [],
  };

  const seenInFile = new Set<string>();

  rows.forEach((row, index) => {
    const sourceRow = index + 1;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const rawPhone = typeof row.phone === "string" ? row.phone : "";

    if (!name) {
      result.rejected.push({ sourceRow, reason: "missing name" });
      return;
    }

    const { value: phone, reason } = normalisePhone(rawPhone);
    if (!phone) {
      result.rejected.push({
        sourceRow,
        reason: `invalid phone (${reason})`,
        value: rawPhone || undefined,
      });
      return;
    }

    if (seenInFile.has(phone)) {
      result.duplicatesInFile.push({ sourceRow, reason: "duplicate within file", value: phone });
      return;
    }

    if (existingPhones.has(phone)) {
      result.duplicatesInDatabase.push({
        sourceRow,
        reason: "lead already exists in this workspace",
        value: phone,
      });
      return;
    }

    seenInFile.add(phone);

    // Columns the mapping did not claim are kept rather than dropped: TRD §7 gives Lead
    // a custom_fields JSON column precisely so an Industry Template can surface them.
    const known = new Set(["name", "phone", "city"]);
    const extras = Object.entries(row).filter(
      ([key, value]) => !known.has(key) && value !== null && value !== undefined && value !== "",
    );

    result.toInsert.push({
      name,
      phone,
      city: typeof row.city === "string" && row.city.trim() ? row.city.trim() : null,
      customFields: extras.length > 0 ? Object.fromEntries(extras) : null,
      sourceRow,
    });
  });

  return result;
}

/**
 * Applies the user's column mapping to the parsed CSV.
 *
 * `mapping` is {targetField: csvHeader} — the direction the mapping UI produces, where
 * the user picks a CSV column for each field the system knows about, rather than
 * labelling every column in a file that may have forty of them.
 */
export function applyColumnMapping(
  records: Record<string, string>[],
  mapping: Record<string, string>,
): ImportRow[] {
  const inverted = new Map<string, string>();
  for (const [field, header] of Object.entries(mapping)) {
    if (header) inverted.set(header, field);
  }

  return records.map((record) => {
    const row: ImportRow = {};
    for (const [header, value] of Object.entries(record)) {
      // An unmapped column keeps its original header and lands in custom_fields.
      row[inverted.get(header) ?? header] = value;
    }
    return row;
  });
}
