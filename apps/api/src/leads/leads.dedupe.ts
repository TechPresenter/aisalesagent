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

/** The fewest digits normalisePhone keeps, so the shortest a stored number can be. */
const MIN_PHONE_DIGITS = 8;

/** A normalised Indian mobile: 91 and ten digits starting 6–9. */
const NORMALISED_INDIAN_MOBILE = /^91[6-9]\d{9}$/;

/**
 * Which do-not-call entries stop a call to `phone`, a normalised lead number: entries
 * stored as one of `equals`, plus — when `endingWith` is set — any entry ending in it.
 *
 * An Indian mobile has exactly one normalised spelling, so equality is the whole match.
 * Any other number is a landline or an international one, and those can be typed with
 * or without their country or area code on either side: "+1 415 555 0100" on the block
 * list and "415-555-0100" on the lead normalise to "14155550100" and "4155550100". The
 * blocked list this replaced matched by digit suffix for that reason, so for these
 * numbers the gate still does, both ways round. Every suffix tried is at least as long
 * as a phone number can be, so a stray short entry blocks nothing.
 */
export function suppressionCandidates(phone: string): {
  equals: string[];
  endingWith: string | null;
} {
  if (NORMALISED_INDIAN_MOBILE.test(phone)) return { equals: [phone], endingWith: null };

  const equals: string[] = [];
  for (let start = 0; phone.length - start >= MIN_PHONE_DIGITS; start += 1) {
    equals.push(phone.slice(start));
  }
  return { equals: equals.length > 0 ? equals : [phone], endingWith: phone };
}

export interface ImportRow {
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  doNotCall?: string | null;
  consentCapturedAt?: string | null;
  [key: string]: unknown;
}

export interface PreparedLead {
  name: string;
  phone: string;
  city: string | null;
  /** The file said this person must not be called. */
  doNotCall: boolean;
  consentCapturedAt: Date | null;
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
  /** Rows dropped because the number is on the workspace's do-not-call list. */
  suppressed: RejectedRow[];
  /** Rows dropped because they were unusable — no name, no parseable phone. */
  rejected: RejectedRow[];
  /**
   * Every usable number the file itself marks do-not-call, whichever bucket its row
   * landed in. An opt-out is honoured even when the lead is a duplicate and is not
   * imported: the file is still telling us this person must not be called.
   */
  doNotCallPhones: string[];
}

/**
 * Decides what an import should actually insert.
 *
 * `existingPhones` is the set of normalised numbers the workspace already holds, and
 * `suppressedPhones` the numbers on its do-not-call list. Passing them in rather than
 * querying inside keeps this function pure and testable, and lets the caller fetch each
 * in one query instead of one per row.
 *
 * Within-file duplicates keep the *first* occurrence. That is the one choice here a
 * reader might expect to go the other way: last-wins would let a corrected row later in
 * the file override an earlier one. First-wins is chosen because import files are
 * usually concatenations of exports, where the earlier rows are the older, more
 * complete records and the later ones are partial re-exports.
 *
 * A suppressed number is reported as suppressed even when the workspace also holds it
 * as a lead: "this person asked not to be called" is the fact worth seeing in a preview.
 */
export function dedupeImportRows(
  rows: ImportRow[],
  existingPhones: Set<string>,
  suppressedPhones: Set<string> = new Set(),
): DedupeResult {
  const result: DedupeResult = {
    toInsert: [],
    duplicatesInFile: [],
    duplicatesInDatabase: [],
    suppressed: [],
    rejected: [],
    doNotCallPhones: [],
  };

  const seenInFile = new Set<string>();
  const doNotCall = new Set<string>();

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

    const dnd = parseDoNotCall(row.doNotCall);
    if (dnd === null) {
      // Guessing is the wrong direction here: reading "maybe" as "fine to call" is the
      // mistake that rings someone who opted out. The row comes back for a person to fix.
      result.rejected.push({
        sourceRow,
        reason: "unrecognised do-not-call value (use yes or no)",
        value: String(row.doNotCall),
      });
      return;
    }
    if (dnd) doNotCall.add(phone);

    const consent = parseConsentDate(row.consentCapturedAt);
    if (consent === undefined) {
      result.rejected.push({
        sourceRow,
        reason: "consent date must be a real date written YYYY-MM-DD",
        value: String(row.consentCapturedAt),
      });
      return;
    }
    // A day of slack for time zones; beyond that, consent "given" next week is a typo.
    if (consent && consent.getTime() > Date.now() + 86_400_000) {
      result.rejected.push({
        sourceRow,
        reason: "consent date is in the future",
        value: String(row.consentCapturedAt),
      });
      return;
    }

    if (seenInFile.has(phone)) {
      result.duplicatesInFile.push({ sourceRow, reason: "duplicate within file", value: phone });
      return;
    }

    if (suppressedPhones.has(phone)) {
      result.suppressed.push({
        sourceRow,
        reason: "number is on this workspace's do-not-call list",
        value: phone,
      });
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
    const extras = Object.entries(row).filter(
      ([key, value]) =>
        !KNOWN_FIELDS.has(key) && value !== null && value !== undefined && value !== "",
    );

    result.toInsert.push({
      name,
      phone,
      city: typeof row.city === "string" && row.city.trim() ? row.city.trim() : null,
      doNotCall: dnd,
      consentCapturedAt: consent,
      customFields: extras.length > 0 ? Object.fromEntries(extras) : null,
      sourceRow,
    });
  });

  result.doNotCallPhones = [...doNotCall];
  return result;
}

/** Fields an import fills on the lead itself; every other column goes to custom_fields. */
const KNOWN_FIELDS = new Set(["name", "phone", "city", "doNotCall", "consentCapturedAt"]);

const DO_NOT_CALL_YES = new Set(["yes", "y", "true", "1", "dnd", "dnc", "x", "do not call"]);
const DO_NOT_CALL_NO = new Set(["no", "n", "false", "0", ""]);

/**
 * Reads a do-not-call cell. True and false for the spellings spreadsheets actually use,
 * and null for anything else — which the caller rejects rather than guesses at.
 */
export function parseDoNotCall(value: unknown): boolean | null {
  if (value === null || value === undefined) return false;
  const text = String(value).trim().toLowerCase().replace(/[_-]+/g, " ");
  if (DO_NOT_CALL_YES.has(text)) return true;
  if (DO_NOT_CALL_NO.has(text)) return false;
  return null;
}

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Reads a consent-date cell: null when blank, a Date for ISO 8601, and undefined for
 * anything else.
 *
 * ISO only, deliberately. "05/10/2026" is the 5th of October to the Indian user who typed
 * it and the 10th of May to JavaScript, and a consent record that is quietly wrong by
 * five months is worse than a row sent back to be fixed.
 */
export function parseConsentDate(value: unknown): Date | null | undefined {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (!ISO_DATE.test(text)) return undefined;

  // JavaScript rolls "2026-02-30" over into March rather than refusing it, so the
  // calendar date is checked on its own before the string is handed to Date.
  const [year, month, day] = text.slice(0, 10).split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }

  const date = new Date(text.length === 10 ? `${text}T00:00:00Z` : text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Applies the user's column mapping to the parsed CSV.
 *
 * `mapping` is {targetField: csvHeader} — the direction the mapping UI produces, where
 * the user picks a CSV column for each field the system knows about, rather than
 * labelling every column in a file that may have forty of them.
 *
 * One column is claimed without being asked for: a do-not-call column, recognised by its
 * header ("DND", "Do not call", "do_not_call", "DNC"). An opt-out that a CRM export
 * carried is not something the uploader should have to remember to map — left to land in
 * custom_fields, it would import the person as callable.
 */
export function applyColumnMapping(
  records: Record<string, string>[],
  mapping: Record<string, string>,
): ImportRow[] {
  const inverted = new Map<string, string>();
  for (const [field, header] of Object.entries(mapping)) {
    if (header) inverted.set(header, field);
  }

  if (!mapping.doNotCall && records.length > 0) {
    const header = Object.keys(records[0]).find(
      (candidate) => !inverted.has(candidate) && isDoNotCallHeader(candidate),
    );
    if (header) inverted.set(header, "doNotCall");
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

const DO_NOT_CALL_HEADERS = new Set(["dnd", "dnc", "do not call", "donotcall", "do not disturb"]);

/** "DND", "Do Not Call", "do_not_call" and "do-not-call" all name the same column. */
export function isDoNotCallHeader(header: string): boolean {
  return DO_NOT_CALL_HEADERS.has(
    header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "),
  );
}
