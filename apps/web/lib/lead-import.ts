import { ApiError, leadsApi, type ImportSummary, type LawfulBasis } from "./api-client";
import { CsvFormatError, parseCsv } from "./csv";
import { normalisePhonePreview } from "./phone";
import type { LeadSource } from "./types";

/**
 * Sends a CSV lead import to the API: split into batches, checked with a dry run, then
 * committed, with the per-batch answers added back up into one report for the whole file.
 *
 * The browser never decides what gets imported. The server parses, de-duplicates against
 * the workspace and its do-not-call list, and inserts; this module only gets the file
 * there in pieces it will accept, and translates its answers back into the user's own row
 * numbers. Kept free of React so the sequence — dry run first, commit second, nothing
 * reported as done until the server says so — is tested directly (lead-import.spec.ts).
 */

/**
 * The most data rows one file may hold. The API refuses more, and the browser says so
 * before uploading anything rather than after the first batch.
 */
export const MAX_IMPORT_ROWS = 10_000;

/**
 * Rows per request. Small enough that each request finishes well inside a serverless
 * function's time limit and stays far under the API's body limit for this route.
 *
 * The API treats each request as one import, so a file of more than one batch is
 * recorded as several ImportBatch audit rows — one per request, each with the row count
 * and SHA-256 of the batch as sent, not of the file as uploaded — and sends its
 * `leads.imported` integration event once per batch. Grouping them back into one file
 * needs an import id and the original file's hash on every request, which the API does
 * not accept yet. Until then the audit trail ties each lead to the person, time, basis
 * and wording behind it, but not to the uploaded file's own hash.
 */
export const IMPORT_BATCH_ROWS = 2_000;

/**
 * A second bound on each request, for files with very wide rows: the API accepts up to
 * 4 MB on /leads/import, and this leaves room for the JSON envelope and the mapping.
 */
const IMPORT_BATCH_BYTES = 3_000_000;

/**
 * What the importer confirms before any row is written: that the workspace may lawfully
 * contact these people. The wording is the owner's to settle with counsel. The API
 * records which wording was agreed to on every import (IMPORT_ATTESTATION_VERSION on the
 * API, default "draft-2026-10"), so a change to this text must come with a new version
 * there.
 */
export const IMPORT_ATTESTATION =
  "I confirm that this workspace may lawfully contact everyone in this file for business " +
  "purposes on the basis chosen above, and that anyone who has asked not to be contacted " +
  "has been left out or is marked do-not-call.";

/**
 * The grounds an uploader can give for contacting the people in a file, as the API names
 * them (LAWFUL_BASES in apps/api/src/leads/dto/lead.dto.ts), with the wording shown beside
 * each. Both lists are counsel's to settle and must change together.
 */
export const LAWFUL_BASIS_OPTIONS: { value: LawfulBasis; label: string }[] = [
  { value: "CONSENT", label: "They agreed to be contacted (a form, a call, an event)" },
  {
    value: "EXISTING_RELATIONSHIP",
    label: "Existing customers, or people who contacted us first",
  },
  {
    value: "LEGITIMATE_INTEREST",
    label: "Business contact details published for business enquiries",
  },
];

/** One row the server skipped, numbered as the user's file numbers it. */
export interface ImportIssue {
  /** 1-based data row in the uploaded file — the header is not counted. */
  sourceRow: number;
  reason: string;
  value?: string;
}

/** The whole file's answer, added up from every batch. */
export interface ImportReport {
  dryRun: boolean;
  /** Data rows in the file. */
  totalRows: number;
  /** On a dry run, how many rows would be imported; on a commit, how many were. */
  imported: number;
  duplicatesInFile: ImportIssue[];
  duplicatesInDatabase: ImportIssue[];
  /** Rows whose number is on the workspace's do-not-call list. */
  suppressed: ImportIssue[];
  rejected: ImportIssue[];
  /**
   * Rows the server skipped under a heading this screen does not know by name. Counted
   * and listed rather than dropped, so the totals always add up to the file.
   */
  otherSkipped: ImportIssue[];
  /** Numbers the file itself marks do-not-call; a commit puts each on the list. */
  doNotCall: number;
}

/**
 * One request's worth of the file: the header row and up to IMPORT_BATCH_ROWS rows, plus
 * any later repeats of a number this batch already carries.
 */
export interface ImportBatch {
  csv: string;
  /** For each row in `csv`, its row number in the uploaded file. */
  rowNumbers: number[];
}

export interface ImportPlan {
  totalRows: number;
  batches: ImportBatch[];
}

/**
 * Splits the file into batches the API will accept.
 *
 * Every row is re-written from the parsed cells rather than sliced out of the original
 * text, so the server reads exactly the rows that were counted here — the same header
 * names the mapping refers to, no blank lines, quoting that cannot drift — and its row
 * numbers can be mapped straight back to the file's. That makes lib/csv.ts the reading
 * that counts, which is why it refuses a file it cannot read one clear way (it throws
 * CsvFormatError) rather than guessing.
 *
 * Every row of one number travels in the same batch: a repeat goes to the batch that
 * holds the number's first row, even if that batch is already full. The server compares
 * rows only within one request, so splitting a number's rows across requests would count
 * a repeat as new on the dry run — and could separate a later row's do-not-call flag from
 * the row it belongs with.
 */
export function planImportBatches(text: string, mapping: Record<string, string>): ImportPlan {
  const parsed = parseCsv(text, Number.POSITIVE_INFINITY);
  const header = toCsvLine(parsed.headers);
  const headerBytes = byteLength(header);

  const batches: { lines: string[]; rowNumbers: number[]; bytes: number }[] = [];
  const batchOfNumber = new Map<string, number>();

  parsed.rows.forEach((row, index) => {
    const line = toCsvLine(parsed.headers.map((name) => row[name] ?? ""));
    const bytes = byteLength(line) + 1;
    const phone = mapping.phone ? normalisePhonePreview(row[mapping.phone]) : null;

    let target = phone ? batchOfNumber.get(phone) : undefined;
    if (target === undefined) {
      const open = batches[batches.length - 1];
      if (
        !open ||
        open.rowNumbers.length >= IMPORT_BATCH_ROWS ||
        open.bytes + bytes > IMPORT_BATCH_BYTES
      ) {
        batches.push({ lines: [], rowNumbers: [], bytes: headerBytes });
      }
      target = batches.length - 1;
      if (phone) batchOfNumber.set(phone, target);
    }

    const batch = batches[target];
    batch.lines.push(line);
    batch.rowNumbers.push(index + 1);
    batch.bytes += bytes;
  });

  return {
    totalRows: parsed.totalRows,
    batches: batches.map((batch) => ({
      csv: [header, ...batch.lines].join("\n"),
      rowNumbers: batch.rowNumbers,
    })),
  };
}

export type ImportRequest = Parameters<typeof leadsApi.import>[0];
export type SendImport = (input: ImportRequest) => Promise<ImportSummary>;

/**
 * How to run the batches. A commit carries the uploader's attestation, so it cannot be
 * asked for without the lawful basis the attestation rests on; the screen only asks for a
 * commit once the box is ticked.
 */
export type RunImportOptions = {
  mapping: Record<string, string>;
  source?: LeadSource;
  onProgress?: (batchesDone: number, batchesTotal: number) => void;
} & ({ dryRun: true } | { dryRun: false; lawfulBasis: LawfulBasis });

/**
 * A commit that failed after some batches had already been written. Those leads are
 * saved, and the report says how many, so the screen can tell the user what happened
 * instead of choosing between "complete" and "failed" when neither is true.
 */
export class ImportInterruptedError extends Error {
  constructor(
    readonly failure: unknown,
    readonly partial: ImportReport,
    readonly batchesDone: number,
    readonly batchesTotal: number,
  ) {
    super(describeImportError(failure));
    this.name = "ImportInterruptedError";
  }
}

/**
 * Runs every batch, in order, as a dry run or as the real thing, and adds the answers up.
 *
 * Sequential on purpose. A later batch's existence check must see the leads an earlier
 * batch inserted, and one request at a time is also what keeps a 10,000-row import from
 * occupying every database connection the workspace shares.
 */
export async function runLeadImport(
  plan: ImportPlan,
  options: RunImportOptions,
  send: SendImport = (input) => leadsApi.import(input),
): Promise<ImportReport> {
  const report: ImportReport = {
    dryRun: options.dryRun,
    totalRows: plan.totalRows,
    imported: 0,
    duplicatesInFile: [],
    duplicatesInDatabase: [],
    suppressed: [],
    rejected: [],
    otherSkipped: [],
    doNotCall: 0,
  };

  const total = plan.batches.length;
  options.onProgress?.(0, total);

  for (let index = 0; index < total; index += 1) {
    const batch = plan.batches[index];
    let summary: ImportSummary;
    try {
      summary = await send({
        csv: batch.csv,
        mapping: options.mapping,
        source: options.source,
        ...(options.dryRun
          ? { dryRun: true }
          : { dryRun: false, attestation: true, lawfulBasis: options.lawfulBasis }),
      });
    } catch (cause) {
      // Nothing was written by a failed dry run, nor by a commit that failed on its
      // first batch (each batch is one transaction), so those are plain failures. Past
      // the first batch some leads exist, and the report has to say so.
      if (!options.dryRun && index > 0) {
        throw new ImportInterruptedError(cause, sortReport(report), index, total);
      }
      throw cause;
    }

    addBatch(report, summary, batch);
    options.onProgress?.(index + 1, total);
  }

  return sortReport(report);
}

const KNOWN_LISTS = new Set(["duplicatesInFile", "duplicatesInDatabase", "suppressed", "rejected"]);

function addBatch(report: ImportReport, summary: ImportSummary, batch: ImportBatch): void {
  const toFileRow = (issue: ImportIssue): ImportIssue => ({
    ...issue,
    sourceRow: batch.rowNumbers[issue.sourceRow - 1] ?? issue.sourceRow,
  });

  const lists = {
    duplicatesInFile: (summary.duplicatesInFile ?? []).map(toFileRow),
    duplicatesInDatabase: (summary.duplicatesInDatabase ?? []).map(toFileRow),
    suppressed: (summary.suppressed ?? []).map(toFileRow),
    rejected: (summary.rejected ?? []).map(toFileRow),
    otherSkipped: Object.entries(summary)
      .filter(([key, value]) => !KNOWN_LISTS.has(key) && Array.isArray(value))
      .flatMap(([, value]) => (value as unknown[]).filter(isIssue))
      .map(toFileRow),
  };

  report.duplicatesInFile.push(...lists.duplicatesInFile);
  report.duplicatesInDatabase.push(...lists.duplicatesInDatabase);
  report.suppressed.push(...lists.suppressed);
  report.rejected.push(...lists.rejected);
  report.otherSkipped.push(...lists.otherSkipped);
  report.doNotCall += summary.doNotCall ?? 0;

  // A dry run reports `imported: 0` — nothing was imported — so what it *would* import is
  // whatever the batch held that no list claimed.
  const skipped = Object.values(lists).reduce((sum, list) => sum + list.length, 0);
  report.imported += report.dryRun
    ? Math.max(0, batch.rowNumbers.length - skipped)
    : summary.imported;
}

function isIssue(value: unknown): value is ImportIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ImportIssue).sourceRow === "number" &&
    typeof (value as ImportIssue).reason === "string"
  );
}

function sortReport(report: ImportReport): ImportReport {
  const byRow = (a: ImportIssue, b: ImportIssue) => a.sourceRow - b.sourceRow;
  return {
    ...report,
    duplicatesInFile: [...report.duplicatesInFile].sort(byRow),
    duplicatesInDatabase: [...report.duplicatesInDatabase].sort(byRow),
    suppressed: [...report.suppressed].sort(byRow),
    rejected: [...report.rejected].sort(byRow),
    otherSkipped: [...report.otherSkipped].sort(byRow),
  };
}

/**
 * What the review step offers once the dry run is back.
 *
 * A commit does two things: it inserts the new leads, and it puts every number the file
 * marks do-not-call on the workspace's list — including numbers whose leads already
 * exist and are skipped as duplicates. So a file with nothing new to import can still
 * have something to commit: an opt-out list for leads the workspace already holds is
 * exactly that, and refusing to commit it would leave those people callable.
 *
 * Only a dry run's report can be committed. The report a commit returns describes what
 * was written, and offering to commit it would be offering the same file twice.
 */
export type CommitOffer =
  | { kind: "import"; label: string }
  | { kind: "do-not-call"; label: string }
  | { kind: "nothing" };

export function commitOffer(preview: ImportReport | null): CommitOffer {
  if (!preview || !preview.dryRun) return { kind: "nothing" };
  if (preview.imported > 0) {
    const leads = preview.imported === 1 ? "lead" : "leads";
    return { kind: "import", label: `Import ${count(preview.imported)} ${leads}` };
  }
  if (preview.doNotCall > 0) {
    const numbers = preview.doNotCall === 1 ? "number" : "numbers";
    return {
      kind: "do-not-call",
      label: `Apply ${count(preview.doNotCall)} do-not-call ${numbers}`,
    };
  }
  return { kind: "nothing" };
}

function count(value: number): string {
  return value.toLocaleString("en-IN");
}

/**
 * The commit the review step may send, or null while it may not: before a dry run, when
 * the dry run found nothing to commit, or until the uploader has chosen a basis and
 * ticked the attestation. The screen's Import button is enabled exactly when this is not
 * null, and sends what it returns.
 */
export function commitRequest(
  preview: ImportReport | null,
  consent: { attested: boolean; lawfulBasis: LawfulBasis | "" },
): { lawfulBasis: LawfulBasis } | null {
  if (commitOffer(preview).kind === "nothing") return null;
  if (!consent.attested || consent.lawfulBasis === "") return null;
  return { lawfulBasis: consent.lawfulBasis };
}

/** The sentence the import screen shows for a failed request. */
export function describeImportError(cause: unknown): string {
  if (cause instanceof ImportInterruptedError) return cause.message;
  if (cause instanceof CsvFormatError) return cause.message;
  if (cause instanceof ApiError) {
    if (cause.status === 403) {
      return "Your role does not allow importing leads. Ask a workspace owner, admin or manager to import this file.";
    }
    if (cause.status === 413) {
      return "This file is too large to upload. Split it into smaller files and import them one after another.";
    }
    return cause.message || "The import was refused. Check the file and try again.";
  }
  return "We could not reach the server. Check your connection and try again.";
}

/** Quotes a field only when CSV requires it. */
function toCsvLine(fields: string[]): string {
  return fields
    .map((field) => (/[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field))
    .join(",");
}

const encoder = new TextEncoder();

/** Bytes this text adds to the JSON request body — escaped, then UTF-8 encoded. */
function byteLength(text: string): number {
  return encoder.encode(JSON.stringify(text)).length;
}
