/**
 * A small CSV reader for the import screen's preview step.
 *
 * The server parses the file for real with `csv-parse` when the import is submitted
 * (apps/api/src/leads/leads.service.ts). This exists only so the browser can show the
 * user their own columns and first few rows before they commit — and doing that in the
 * browser is what makes the mapping step possible at all, since the user has to see the
 * headers to map them.
 *
 * It handles quoted fields, escaped quotes and newlines inside quotes, because those are
 * what a spreadsheet export actually produces. It does not handle alternative delimiters
 * or multi-character quotes; a file that needs those will parse oddly in the preview and
 * correctly on the server, which is the right way round for the failure to land.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Total data rows in the file, even when only the first few were kept for preview. */
  totalRows: number;
}

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
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Consume the \n of a \r\n pair so it does not open an empty record.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  return records;
}

/** The lead fields the import can target. `phone` is the only one that is not optional. */
export const IMPORT_FIELDS = [
  { key: "name", label: "Lead / Clinic Name", required: true },
  { key: "phone", label: "Phone Number", required: true },
  { key: "contactPerson", label: "Contact Person", required: false },
  { key: "email", label: "Email", required: false },
  { key: "city", label: "City", required: false },
  { key: "category", label: "Category", required: false },
  { key: "address", label: "Address", required: false },
] as const;

/**
 * First guess at the mapping, so a well-formed export needs no manual work.
 *
 * Matching is done on letters only — "Phone Number", "phone_number" and "PhoneNo" all
 * reduce to the same key — and the alias lists are ordered, so an exact-ish match wins
 * over a loose one. The user can override every choice; this only removes the tedium
 * from the common case.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["leadclinicname", "clinicname", "leadname", "businessname", "companyname", "name", "clinic", "lead"],
  phone: ["phonenumber", "mobilenumber", "contactnumber", "phone", "mobile", "contactno", "number"],
  contactPerson: ["contactperson", "contactname", "ownername", "doctor", "doctorname", "contact", "person"],
  email: ["emailaddress", "email", "mail", "emailid"],
  city: ["city", "town", "location", "district"],
  category: ["category", "speciality", "specialty", "type", "businesstype", "segment"],
  address: ["address", "streetaddress", "fulladdress", "addressline"],
};

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
    if (!mapping[field]) {
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
