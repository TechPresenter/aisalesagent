"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import type { LawfulBasis } from "@/lib/api-client";
import { normalisePhonePreview } from "@/lib/phone";
import { CsvFormatError, IMPORT_FIELDS, guessMapping, parseCsv, type ParsedCsv } from "@/lib/csv";
import {
  IMPORT_ATTESTATION,
  ImportInterruptedError,
  LAWFUL_BASIS_OPTIONS,
  MAX_IMPORT_ROWS,
  commitOffer,
  commitRequest,
  describeImportError,
  planImportBatches,
  runLeadImport,
  type ImportIssue,
  type ImportReport,
} from "@/lib/lead-import";
import { cn } from "@/lib/utils";

type Step = "upload" | "map" | "review" | "done";

/** Where a request is: checking (dry run) or importing (commit), and how many parts are done. */
interface Busy {
  phase: "check" | "import";
  done: number;
  total: number;
}

interface Outcome {
  report: ImportReport;
  /** False when a commit stopped part-way; `report` then counts what was saved before it. */
  complete: boolean;
  message?: string;
}

const UNMAPPED = "";

/** How many problem rows are listed before the rest collapse into "and N more". */
const LISTED_ISSUES = 20;

/**
 * Feature List §2 — "Bulk CSV import: column mapping and de-duplication on import."
 *
 * Four steps, and the middle two are the point. A spreadsheet export never has the
 * column names we want, so the user tells us which column is which; then the server
 * checks the whole file with a dry run and says what it would do, before anything is
 * written.
 *
 * The dry run is deliberate. Import is the one action here that can put thousands of
 * rows into a workspace, and telling someone afterwards that 400 of their 500 rows were
 * duplicates is much worse than telling them first. Every number on the review and done
 * steps is the server's answer (lib/lead-import.ts); "Import complete" appears only once
 * a commit has come back.
 */
export function CsvImport() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The attestation and the basis it rests on. Asked for on every review, never carried
  // over from a previous file: each file is its own statement.
  const [attested, setAttested] = useState(false);
  const [lawfulBasis, setLawfulBasis] = useState<LawfulBasis | "">("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Closing the tab mid-commit stops the batches not yet sent and loses the report of
  // the ones that were, so the browser is asked to confirm first.
  const committing = busy?.phase === "import";
  useEffect(() => {
    if (!committing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [committing]);

  const startOver = () => {
    setStep("upload");
    setParsed(null);
    setCsvText("");
    setPreview(null);
    setOutcome(null);
    setAttested(false);
    setLawfulBasis("");
  };

  const readFile = async (file: File) => {
    setError(null);

    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError(
        "That is not a CSV file. Save your spreadsheet as CSV (File › Save as, or Download › CSV) and try again.",
      );
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("That file could not be read. Save it again as CSV and try again.");
      return;
    }

    // A file whose quoting cannot be read one clear way is refused here, by row, before
    // anything is mapped or sent: the rows this reads are the rows that get imported.
    let result: ParsedCsv;
    try {
      result = parseCsv(text);
    } catch (cause) {
      if (!(cause instanceof CsvFormatError)) throw cause;
      setError(`${file.name} could not be read. ${cause.message}`);
      return;
    }

    if (result.headers.length === 0 || result.totalRows === 0) {
      setError("That file has a header row but no data rows.");
      return;
    }

    if (result.totalRows > MAX_IMPORT_ROWS) {
      setError(
        `That file has ${result.totalRows.toLocaleString("en-IN")} rows. Import up to ` +
          `${MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows at a time: split it into smaller ` +
          "files and import them one after another.",
      );
      return;
    }

    setFileName(file.name);
    setCsvText(text);
    setParsed(result);
    setMapping(guessMapping(result.headers));
    setPreview(null);
    setOutcome(null);
    setAttested(false);
    setLawfulBasis("");
    setStep("map");
  };

  // What the review step can commit, and the commit itself once the basis is chosen and
  // the box ticked (lib/lead-import.ts). Both are null-safe before the dry run is back.
  const offer = commitOffer(preview);
  const commit = commitRequest(preview, { attested, lawfulBasis });

  const requiredMissing = IMPORT_FIELDS.filter(
    (field) => field.required && !mapping[field.key],
  ).map((field) => field.label);

  /** The mapping as the API wants it: fields the user left unmapped are not sent. */
  const chosenMapping = (): Record<string, string> =>
    Object.fromEntries(Object.entries(mapping).filter(([, header]) => header !== UNMAPPED));

  /**
   * The dry run (Check, `commit` null) and the commit (Import) are the same batches with
   * one flag changed; the commit adds the attestation, so it takes the basis it rests on
   * and is only offered once the box is ticked.
   */
  const runImport = async (commit: { lawfulBasis: LawfulBasis } | null) => {
    if (!csvText || busy) return;
    const phase = commit ? "import" : "check";
    const fields = chosenMapping();
    const onProgress = (done: number, total: number) => setBusy({ phase, done, total });

    setError(null);
    setBusy({ phase, done: 0, total: 0 });
    try {
      const report = await runLeadImport(
        planImportBatches(csvText, fields),
        commit
          ? { mapping: fields, source: "UPLOAD", dryRun: false, ...commit, onProgress }
          : { mapping: fields, source: "UPLOAD", dryRun: true, onProgress },
      );

      if (report.dryRun) {
        setPreview(report);
        setAttested(false);
        setLawfulBasis("");
        setStep("review");
      } else {
        setOutcome({ report, complete: true });
        setStep("done");
      }
    } catch (cause) {
      if (cause instanceof ImportInterruptedError) {
        setOutcome({ report: cause.partial, complete: false, message: cause.message });
        setStep("done");
      } else {
        setError(describeImportError(cause));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-accent-blue hover:underline"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
        Back to Leads
      </Link>

      <div className="mt-3 mb-5">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-brand-navy sm:text-display">
          Import Leads
        </h1>
        <p className="mt-1.5 text-[14px] text-slate-500">
          Upload a CSV file, map its columns and check it. Numbers already in your workspace are
          skipped, and nothing is saved until you confirm.
        </p>
      </div>

      <ol className="mb-5 flex flex-wrap items-center gap-2">
        <StepChip
          index={1}
          label="Upload file"
          active={step === "upload"}
          done={step !== "upload"}
        />
        <ArrowRight className="h-4 w-4 text-slate-300" strokeWidth={2} />
        <StepChip
          index={2}
          label="Map columns"
          active={step === "map"}
          done={step === "review" || step === "done"}
        />
        <ArrowRight className="h-4 w-4 text-slate-300" strokeWidth={2} />
        <StepChip index={3} label="Review" active={step === "review"} done={step === "done"} />
        <ArrowRight className="h-4 w-4 text-slate-300" strokeWidth={2} />
        <StepChip index={4} label="Import" active={step === "done"} done={false} />
      </ol>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-card border border-alert-red/30 bg-alert-red/[0.07] p-4"
        >
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-alert-red" strokeWidth={2.2} />
          <p className="text-[13px] text-[#C93B3B]">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="ml-auto shrink-0 text-alert-red/70 hover:text-alert-red"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      )}

      {step === "upload" && (
        <Card className="p-6">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void readFile(file);
            }}
            className={cn(
              "flex flex-col items-center justify-center rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors",
              dragging ? "border-brand-green bg-brand-green/[0.05]" : "border-slate-200",
            )}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-green/[0.13]">
              <Upload className="h-6 w-6 text-brand-green" strokeWidth={2} />
            </span>
            <p className="mt-4 text-[15px] font-semibold text-brand-navy">
              Drop your CSV file here, or choose a file
            </p>
            <p className="mt-1 max-w-md text-[13px] text-slate-500">
              CSV files only: save an Excel or Google Sheets file as CSV first. The first row must
              be the column headers. Up to {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows per file.
            </p>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same file again (after fixing it) fires a change.
                event.target.value = "";
                if (file) void readFile(file);
              }}
            />
            <Button className="mt-5" onClick={() => inputRef.current?.click()}>
              <FileSpreadsheet className="h-4 w-4" strokeWidth={2.2} />
              Choose CSV file
            </Button>
          </div>
        </Card>
      )}

      {step === "map" && parsed && (
        <div className="space-y-4">
          <FileCard
            fileName={fileName}
            parsed={parsed}
            onChange={startOver}
            disabled={busy !== null}
          />

          <Card className="p-5">
            <h2 className="text-[16px] font-bold tracking-tight text-brand-navy">
              Map your columns
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              We have guessed these from your headers. Every other column, such as contact person,
              email or address, is kept on the lead under its own header as a custom field and is
              included when you export your leads. With Do Not Call left unmapped, a column headed
              DND or Do Not Call is still read as do-not-call.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <FilterSelect
                  key={field.key}
                  label={field.required ? `${field.label} *` : field.label}
                  value={mapping[field.key] ?? UNMAPPED}
                  onChange={(value) =>
                    setMapping((current) => ({ ...current, [field.key]: value }))
                  }
                  options={[
                    { value: UNMAPPED, label: "— Not mapped —" },
                    ...parsed.headers.map((header) => ({ value: header, label: header })),
                  ]}
                />
              ))}
            </div>

            {requiredMissing.length > 0 && (
              <p className="mt-3 flex items-center gap-2 text-[12.5px] text-[#B4761A]">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                Map {requiredMissing.join(" and ")} before importing.
              </p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-[16px] font-bold tracking-tight text-brand-navy">Preview</h2>
              <p className="mt-1 text-[13px] text-slate-500">
                The first {Math.min(parsed.rows.length, 8)} rows, as they will be read.
              </p>
            </div>

            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50/80">
                    {IMPORT_FIELDS.map((field) => (
                      <th
                        key={field.key}
                        scope="col"
                        className="whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map((row, index) => (
                    <tr key={index} className="border-t border-slate-100">
                      {IMPORT_FIELDS.map((field) => {
                        const header = mapping[field.key];
                        const raw = header ? row[header] : "";
                        const display =
                          field.key === "phone" && raw
                            ? (normalisePhonePreview(raw) ?? `${raw} (unusable)`)
                            : raw;

                        return (
                          <td
                            key={field.key}
                            className={cn(
                              "whitespace-nowrap px-3 py-2.5 text-[12.5px]",
                              display ? "text-brand-navy" : "text-slate-300",
                              field.key === "phone" && "tabular",
                            )}
                          >
                            {display || "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <p className="mr-auto text-[12.5px] text-slate-500" aria-live="polite">
                {busy?.phase === "check"
                  ? progressText("Checking", busy)
                  : "Checking the file saves nothing."}
              </p>
              <Button variant="secondary" onClick={startOver} disabled={busy !== null}>
                Back
              </Button>
              <Button
                onClick={() => void runImport(null)}
                disabled={requiredMissing.length > 0 || busy !== null}
              >
                {busy?.phase === "check" && (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                )}
                Check {parsed.totalRows.toLocaleString("en-IN")} rows
              </Button>
            </div>
          </Card>
        </div>
      )}

      {step === "review" && parsed && preview && (
        <div className="space-y-4">
          <FileCard
            fileName={fileName}
            parsed={parsed}
            onChange={startOver}
            disabled={busy !== null}
          />

          <Card className="p-6">
            <h2 className="text-[18px] font-bold tracking-tight text-brand-navy">
              Review before importing
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Your workspace has checked every row. Nothing has been saved yet.
            </p>

            <ReportCounts report={preview} importedLabel="Ready to import" />
            <ReportIssues report={preview} />

            {preview.doNotCall > 0 && (
              <p className="mt-4 text-[13px] text-slate-600">
                {preview.doNotCall.toLocaleString("en-IN")}{" "}
                {preview.doNotCall === 1 ? "number is" : "numbers are"} marked do-not-call in this
                file. {offer.kind === "do-not-call" ? "Applying" : "Importing"} the file puts{" "}
                {preview.doNotCall === 1 ? "it" : "them"} on your do-not-call list and marks any
                lead you already have with{" "}
                {preview.doNotCall === 1 ? "that number" : "those numbers"}, so{" "}
                {preview.doNotCall === 1 ? "it is" : "they are"} never dialled.
              </p>
            )}

            {offer.kind === "nothing" && (
              <p className="mt-5 rounded-btn bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
                Nothing in this file can be imported: every row is already in your workspace, on
                your do-not-call list, repeated, or could not be read.
              </p>
            )}

            {offer.kind === "do-not-call" && (
              <p className="mt-5 rounded-btn bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
                There are no new leads in this file, but its do-not-call numbers can still be
                applied to your workspace.
              </p>
            )}

            {offer.kind !== "nothing" && (
              <fieldset className="mt-5 space-y-3 rounded-card border border-slate-200 p-4">
                <legend className="px-1 text-[13px] font-bold text-brand-navy">
                  Permission to contact
                </legend>
                <label className="block max-w-xl">
                  <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                    Why may this workspace contact these people? *
                  </span>
                  <select
                    value={lawfulBasis}
                    onChange={(event) => setLawfulBasis(event.target.value as LawfulBasis | "")}
                    required
                    className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13px] text-brand-navy focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
                  >
                    <option value="">Choose one…</option>
                    {LAWFUL_BASIS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(event) => setAttested(event.target.checked)}
                    required
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-[#19B969]"
                  />
                  <span className="text-[13px] leading-relaxed text-brand-navy">
                    {IMPORT_ATTESTATION}
                  </span>
                </label>
              </fieldset>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <p className="mr-auto text-[12.5px] text-slate-500" aria-live="polite">
                {busy?.phase === "import"
                  ? progressText(offer.kind === "do-not-call" ? "Applying" : "Importing", busy)
                  : null}
              </p>
              <Button variant="secondary" onClick={() => setStep("map")} disabled={busy !== null}>
                Back to mapping
              </Button>
              {offer.kind !== "nothing" && (
                <Button
                  onClick={() => {
                    if (commit) void runImport(commit);
                  }}
                  disabled={commit === null || busy !== null}
                >
                  {busy?.phase === "import" && (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                  )}
                  {offer.label}
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}

      {step === "done" && outcome && (
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full",
                outcome.complete ? "bg-brand-green/[0.13]" : "bg-warning-amber/[0.15]",
              )}
            >
              {outcome.complete ? (
                <CheckCircle2 className="h-5 w-5 text-brand-green" strokeWidth={2.2} />
              ) : (
                <AlertTriangle className="h-5 w-5 text-[#B4761A]" strokeWidth={2.2} />
              )}
            </span>
            <div>
              <h2 className="text-[18px] font-bold tracking-tight text-brand-navy">
                {!outcome.complete
                  ? "Import stopped part-way"
                  : outcome.report.imported === 0 && outcome.report.doNotCall > 0
                    ? "Do-not-call list updated"
                    : "Import complete"}
              </h2>
              <p className="text-[13px] text-slate-500">{fileName}</p>
            </div>
          </div>

          {!outcome.complete && (
            <p className="mt-4 rounded-btn bg-warning-amber/[0.1] px-4 py-3 text-[13px] leading-relaxed text-[#8A5A12]">
              {outcome.message} The leads counted below were saved before it stopped. Importing the
              same file again is safe: rows already in your workspace are skipped.
            </p>
          )}

          <ReportCounts report={outcome.report} importedLabel="Imported" />
          {outcome.report.doNotCall > 0 && (
            <p className="mt-4 text-[13px] text-slate-600">
              {outcome.report.doNotCall.toLocaleString("en-IN")}{" "}
              {outcome.report.doNotCall === 1 ? "number" : "numbers"} from this file{" "}
              {outcome.report.doNotCall === 1 ? "is" : "are"} now on your do-not-call list.
            </p>
          )}
          <ReportIssues report={outcome.report} />

          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/leads">View leads</Link>
            </Button>
            {!outcome.complete && (
              <Button
                variant="secondary"
                onClick={() => {
                  setOutcome(null);
                  setPreview(null);
                  setStep("map");
                }}
              >
                Check this file again
              </Button>
            )}
            <Button variant="secondary" onClick={startOver}>
              Import another file
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

function progressText(verb: string, busy: Busy): string {
  return busy.total > 1
    ? `${verb} part ${Math.min(busy.done + 1, busy.total)} of ${busy.total}…`
    : `${verb}…`;
}

function FileCard({
  fileName,
  parsed,
  onChange,
  disabled,
}: {
  fileName: string;
  parsed: ParsedCsv;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <FileSpreadsheet className="h-5 w-5 text-brand-green" strokeWidth={2} />
          <div>
            <p className="text-[14px] font-semibold text-brand-navy">{fileName}</p>
            <p className="tabular text-[12.5px] text-slate-500">
              {parsed.totalRows.toLocaleString("en-IN")} rows &middot; {parsed.headers.length}{" "}
              columns
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={onChange} disabled={disabled}>
          Choose a different file
        </Button>
      </div>
    </Card>
  );
}

/** The totals, as the server reported them. Together they account for every row. */
function ReportCounts({ report, importedLabel }: { report: ImportReport; importedLabel: string }) {
  return (
    <dl
      className={cn(
        "mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3",
        report.otherSkipped.length > 0 ? "lg:grid-cols-6" : "lg:grid-cols-5",
      )}
    >
      <Summary label={importedLabel} value={report.imported} tone="text-brand-green" />
      <Summary label="Duplicates in file" value={report.duplicatesInFile.length} />
      <Summary label="Already in workspace" value={report.duplicatesInDatabase.length} />
      <Summary label="On do-not-call list" value={report.suppressed.length} />
      <Summary
        label="Cannot be imported"
        value={report.rejected.length}
        tone={report.rejected.length > 0 ? "text-alert-red" : undefined}
      />
      {report.otherSkipped.length > 0 && (
        <Summary label="Skipped" value={report.otherSkipped.length} />
      )}
    </dl>
  );
}

/**
 * The rows that will not (or did not) import and why, by their row in the user's file.
 * Unreadable rows are listed openly because they need fixing; duplicates and numbers on
 * the do-not-call list are tucked away because they are the import doing its job.
 */
function ReportIssues({ report }: { report: ImportReport }) {
  const problems = [...report.rejected, ...report.otherSkipped].sort(
    (a, b) => a.sourceRow - b.sourceRow,
  );
  const duplicates = [
    ...report.duplicatesInFile,
    ...report.duplicatesInDatabase,
    ...report.suppressed,
  ].sort((a, b) => a.sourceRow - b.sourceRow);

  if (problems.length === 0 && duplicates.length === 0) return null;

  return (
    <div className="mt-5 space-y-4">
      {problems.length > 0 && (
        <div>
          <h3 className="text-[13px] font-bold text-brand-navy">Rows that cannot be imported</h3>
          <IssueList issues={problems} />
        </div>
      )}

      {duplicates.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold text-accent-blue hover:underline">
            Show the {duplicates.length.toLocaleString("en-IN")} skipped{" "}
            {duplicates.length === 1 ? "row" : "rows"} (duplicates and do-not-call numbers)
          </summary>
          <IssueList issues={duplicates} />
        </details>
      )}

      <p className="text-[12px] text-slate-500">
        Row numbers count the data rows in your file, starting with the first row under the headers.
      </p>
    </div>
  );
}

function IssueList({ issues }: { issues: ImportIssue[] }) {
  return (
    <>
      <ul className="mt-2 space-y-1">
        {issues.slice(0, LISTED_ISSUES).map((issue) => (
          <li
            key={`${issue.sourceRow}-${issue.reason}`}
            className="tabular text-[12.5px] text-slate-600"
          >
            Row {issue.sourceRow.toLocaleString("en-IN")}: {issue.reason}
            {issue.value ? ` (${issue.value})` : ""}
          </li>
        ))}
      </ul>
      {issues.length > LISTED_ISSUES && (
        <p className="mt-1 text-[12.5px] text-slate-500">
          and {(issues.length - LISTED_ISSUES).toLocaleString("en-IN")} more
        </p>
      )}
    </>
  );
}

function StepChip({
  index,
  label,
  active,
  done,
}: {
  index: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold",
        active
          ? "bg-brand-green/[0.13] text-deep-green"
          : done
            ? "bg-slate-100 text-slate-500"
            : "bg-slate-50 text-slate-400",
      )}
    >
      <span
        className={cn(
          "tabular flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
          active ? "bg-brand-green text-white" : "bg-slate-200 text-slate-500",
        )}
      >
        {done ? <CheckCircle2 className="h-3 w-3" strokeWidth={2.6} /> : index}
      </span>
      {label}
    </li>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-card border border-slate-200 p-3.5">
      <dt className="text-[12px] text-slate-500">{label}</dt>
      <dd className={cn("tabular mt-1 text-[24px] font-bold leading-none text-brand-navy", tone)}>
        {value.toLocaleString("en-IN")}
      </dd>
    </div>
  );
}
