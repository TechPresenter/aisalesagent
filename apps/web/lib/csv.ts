/**
 * The CSV reader for the import screen.
 *
 * The browser reads the file so it can show the user their own columns and first few
 * rows — the mapping step is impossible without the headers — and then, in
 * lib/lead-import.ts, re-writes these same parsed rows into the batches it uploads. The
 * server parses each batch again with `csv-parse` (apps/api/src/leads/leads.service.ts),
 * but by then the quoting is the browser's own and cannot be misread. So this reading,
 * not the server's, decides which rows the server ever sees, and a file this reader gets
 * wrong is imported wrong. That is why it refuses a file rather than guess at it.
 *
 * It handles quoted fields, escaped quotes and newlines inside quotes, because those are
 * what a spreadsheet export actually produces. A quote mark in the middle of an
 * unquoted field — `Pune 24" Road` — is kept as an ordinary character, as `csv-parse`
 * does with `relax_quotes`, rather than starting a quoted section that would swallow
 * every comma and line break up to the next quote in the file. A quoted field that is
 * never closed, or has text after its closing quote, has no reading that is clearly the
 * right one, so it is refused by row (CsvFormatError) for the user to fix. Alternative
 * delimiters and multi-character quotes are not handled.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Total data rows in the file, even when only the first few were kept for preview. */
  totalRows: number;
}

/**
 * A file whose quoting cannot be read one clear way. `row` counts data rows as the import
 * report does — the first row under the headers is 1, blank lines are not counted — and
 * is 0 for the header row itself.
 */
export class CsvFormatError extends Error {
  constructor(
    readonly row: number,
    problem: string,
  ) {
    super(
      `${row === 0 ? "The header row" : `Row ${row.toLocaleString("en-IN")}`} ${problem}. ` +
        "Fix it in your spreadsheet, save the file as CSV again and choose it here. " +
        "Row numbers count the data rows, starting with the first row under the headers.",
    );
    this.name = "CsvFormatError";
  }
}

/** Throws CsvFormatError for a file whose quoting cannot be read one clear way. */
export function parseCsv(text: string, previewRows = 20): ParsedCsv {
  const records = tokenise(stripBom(text));

  if (records.length === 0) {
    return { headers: [], rows: [], totalRows: 0 };
  }

  const headers = records[0].map((header, index) => header.trim() || `Column ${index + 1}`);
  const dataRows = records.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""));

  const rows = dataRows.slice(0, previewRows).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (row[index] ?? "").trim();
    });
    return record;
  });

  return { headers, rows, totalRows: dataRows.length };
}

/** Excel writes a UTF-8 BOM; left in place it becomes part of the first header's name. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function tokenise(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Set once a quoted field's closing quote is read: from there to the next comma or
  // line break only spaces may follow.
  let afterClosingQuote = false;
  // The data row the open quoted field started on, for the error if it never closes.
  let quoteRow = 0;
  // Non-blank data rows completed so far, so an error names the row the way the import
  // report numbers rows. Counted as records are pushed rather than recounted per error.
  let dataRows = 0;

  const currentRow = () => (records.length === 0 ? 0 : dataRows + 1);

  const endField = () => {
    row.push(field);
    field = "";
    afterClosingQuote = false;
  };

  const endRecord = () => {
    endField();
    if (records.length > 0 && row.some((cell) => cell.trim() !== "")) dataRows += 1;
    records.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is an escaped quote, not the end of it.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === ",") {
      endField();
    } else if (char === "\n" || char === "\r") {
      // Consume the \n of a \r\n pair so it does not open an empty record.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
    } else if (afterClosingQuote) {
      // `"Pune 24" Road"` — whatever was meant, it was not one field ending at the
      // second quote, and reading on would misplace every quote after it.
      if (char !== " " && char !== "\t") {
        throw new CsvFormatError(
          quoteRow,
          `has text straight after the closing quote mark of a quoted value. ` +
            `Inside a quoted value, write a quote mark as two ("")`,
        );
      }
    } else if (char === '"' && field.trim() === "") {
      // A quote opens a quoted field only at the field's start (leading spaces aside).
      inQuotes = true;
      quoteRow = currentRow();
      field = "";
    } else {
      // Anywhere else — `Pune 24" Road` — it is part of the value.
      field += char;
    }
  }

  if (inQuotes) {
    throw new CsvFormatError(
      quoteRow,
      "has a quote mark that opens a quoted value and is never closed",
    );
  }

  if (field !== "" || row.length > 0) {
    endRecord();
  }

  return records;
}

/**
 * The lead fields the import can target: exactly the ones the API's import writes to the
 * lead's own columns (KNOWN_FIELDS in apps/api/src/leads/leads.dedupe.ts). Every other
 * column is kept on the lead as a custom field under its own header.
 *
 * Contact person, email, address and category are deliberately absent until the API's
 * import stores them in their columns. Offered here before that, a mapped "Contact" column
 * would be saved as a custom field named `contactPerson`, and the lead would show "—"
 * for the contact the user had just mapped. Adding a field to the API's import and to
 * this list (with its aliases below) is the whole change.
 *
 * Do-not-call and consent date are lead columns the import already fills. The server
 * finds a "DND" or "Do not call" column by itself; listing it here lets the user see that
 * and point it at a column with any other name.
 */
export const IMPORT_FIELDS = [
  { key: "name", label: "Lead / Company Name", required: true },
  { key: "phone", label: "Phone Number", required: true },
  { key: "city", label: "City", required: false },
  { key: "doNotCall", label: "Do Not Call (yes / no)", required: false },
  { key: "consentCapturedAt", label: "Consent Date (YYYY-MM-DD)", required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

/**
 * First guess at the mapping, so a well-formed export needs no manual work.
 *
 * Matching is done on letters only — "Phone Number", "phone_number" and "PhoneNo" all
 * reduce to the same key — and the alias lists are ordered, so an exact-ish match wins
 * over a loose one. The user can override every choice; this only removes the tedium
 * from the common case.
 */
const FIELD_ALIASES: Record<ImportFieldKey, string[]> = {
  // The label's own spelling first. The clinic spellings stay: the field used to be
  // labelled "Lead / Clinic Name", and a sheet of clinics with a "Clinic" column should
  // still map without help.
  name: [
    "leadcompanyname",
    "leadclinicname",
    "clinicname",
    "leadname",
    "businessname",
    "companyname",
    "name",
    "clinic",
    "lead",
  ],
  phone: ["phonenumber", "mobilenumber", "contactnumber", "phone", "mobile", "contactno", "number"],
  city: ["city", "town", "location", "district"],
  // The headers the server recognises on its own (isDoNotCallHeader in leads.dedupe.ts),
  // so the guess shows what the server would do anyway. Exact matches only: a loose
  // "contains" match could claim a column that merely mentions calls.
  doNotCall: ["dnd", "dnc", "donotcall", "donotdisturb"],
  consentCapturedAt: [
    "consentdate",
    "consentcapturedat",
    "consentcapturedon",
    "consentedon",
    "optindate",
  ],
};

/** Fields whose header must match an alias exactly; the loose fallback is not tried. */
const EXACT_ONLY = new Set<string>(["doNotCall", "consentCapturedAt"]);

export function guessMapping(headers: string[]): Record<string, string> {
  const normalised = headers.map((header) => ({
    header,
    key: header.toLowerCase().replace(/[^a-z]/g, ""),
  }));

  const mapping: Record<string, string> = {};
  const claimed = new Set<string>();

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const match = normalised.find(
        (candidate) => !claimed.has(candidate.header) && candidate.key === alias,
      );
      if (match) {
        mapping[field] = match.header;
        claimed.add(match.header);
        break;
      }
    }

    // Only if nothing matched exactly: fall back to a header that contains the alias.
    if (!mapping[field] && !EXACT_ONLY.has(field)) {
      for (const alias of aliases) {
        const match = normalised.find(
          (candidate) => !claimed.has(candidate.header) && candidate.key.includes(alias),
        );
        if (match) {
          mapping[field] = match.header;
          claimed.add(match.header);
          break;
        }
      }
    }
  }

  return mapping;
}
