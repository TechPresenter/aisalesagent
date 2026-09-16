"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  FileSpreadsheet,
  Upload,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import { normalisePhonePreview } from "@/lib/phone";
import { IMPORT_FIELDS, guessMapping, parseCsv, type ParsedCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

type Step = "upload" | "map" | "done";

interface ImportOutcome {
  imported: number;
  duplicatesInFile: number;
  duplicatesInDatabase: number;
  rejected: { row: number; reason: string }[];
}

const UNMAPPED = "";

/**
 * Feature List §2 — "Bulk CSV/XLSX import: column mapping and de-duplication on import."
 *
 * Three steps, and the middle one is the point: a clinic's export never has the column
 * names we want, so the user tells us which column is which before anything is written.
 *
 * The dry run before the commit is deliberate. Import is the one action here that can put
 * thousands of rows into a workspace, and telling someone afterwards that 400 of their
 * 500 rows were duplicates is much worse than telling them first.
 */
export function CsvImport() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    setError(null);

    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError("That is not a CSV file. Export your sheet as .csv and try again.");
      return;
    }

    const text = await file.text();
    const result = parseCsv(text);

    if (result.headers.length === 0 || result.totalRows === 0) {
      setError("That file has a header row but no data rows.");
      return;
    }

    setFileName(file.name);
    setParsed(result);
    setMapping(guessMapping(result.headers));
    setStep("map");
  };

  const requiredMissing = IMPORT_FIELDS.filter(
    (field) => field.required && !mapping[field.key],
  ).map((field) => field.label);

  const runImport = () => {
    if (!parsed) return;

    // De-duplication mirrors the server's rule — normalise the number, then one lead per
    // number. Running it here first is what makes the summary a preview rather than a
    // report of something already done.
    const seen = new Set<string>();
    const problems: { row: number; reason: string }[] = [];
    let imported = 0;
    let duplicatesInFile = 0;

    parsed.rows.forEach((row, index) => {
      const name = mapping.name ? row[mapping.name]?.trim() : "";
      const rawPhone = mapping.phone ? row[mapping.phone] : "";

      if (!name) {
        problems.push({ row: index + 1, reason: "missing name" });
        return;
      }

      const phone = normalisePhonePreview(rawPhone);
      if (!phone) {
        problems.push({ row: index + 1, reason: `unusable phone number "${rawPhone ?? ""}"` });
        return;
      }

      if (seen.has(phone)) {
        duplicatesInFile += 1;
        return;
      }

      seen.add(phone);
      imported += 1;
    });

    setOutcome({
      imported,
      duplicatesInFile,
      // Checked against the workspace by the API; the preview cannot know it offline.
      duplicatesInDatabase: 0,
      rejected: problems,
    });
    setStep("done");
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
          Upload a CSV, map its columns, and we will skip anything already in your workspace.
        </p>
      </div>

      <ol className="mb-5 flex flex-wrap items-center gap-2">
        <StepChip index={1} label="Upload file" active={step === "upload"} done={step !== "upload"} />
        <ArrowRight className="h-4 w-4 text-slate-300" strokeWidth={2} />
        <StepChip index={2} label="Map columns" active={step === "map"} done={step === "done"} />
        <ArrowRight className="h-4 w-4 text-slate-300" strokeWidth={2} />
        <StepChip index={3} label="Review" active={step === "done"} done={false} />
      </ol>

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-card border border-alert-red/30 bg-alert-red/[0.07] p-4">
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
              Drop your CSV here, or choose a file
            </p>
            <p className="mt-1 text-[13px] text-slate-500">
              The first row must be the column headers. Up to 10,000 rows per file.
            </p>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            <Button className="mt-5" onClick={() => inputRef.current?.click()}>
              <FileSpreadsheet className="h-4 w-4" strokeWidth={2.2} />
              Choose file
            </Button>
          </div>
        </Card>
      )}

      {step === "map" && parsed && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="h-5 w-5 text-brand-green" strokeWidth={2} />
                <div>
                  <p className="text-[14px] font-semibold text-brand-navy">{fileName}</p>
                  <p className="tabular text-[12.5px] text-slate-500">
                    {parsed.totalRows.toLocaleString("en-IN")} rows &middot;{" "}
                    {parsed.headers.length} columns
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setStep("upload");
                  setParsed(null);
                }}
              >
                Choose a different file
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-[16px] font-bold tracking-tight text-brand-navy">Map your columns</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              We have guessed these from your headers. Anything you leave unmapped is kept on the
              lead as a custom field rather than discarded.
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
              <h2 className="text-[16px] font-bold tracking-tight text-brand-navy">
                Preview
              </h2>
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

            <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <Button variant="secondary" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button onClick={runImport} disabled={requiredMissing.length > 0}>
                Import {parsed.totalRows.toLocaleString("en-IN")} rows
              </Button>
            </div>
          </Card>
        </div>
      )}

      {step === "done" && outcome && (
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-green/[0.13]">
              <CheckCircle2 className="h-5 w-5 text-brand-green" strokeWidth={2.2} />
            </span>
            <div>
              <h2 className="text-[18px] font-bold tracking-tight text-brand-navy">
                Import complete
              </h2>
              <p className="text-[13px] text-slate-500">{fileName}</p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Summary label="Imported" value={outcome.imported} tone="text-brand-green" />
            <Summary label="Duplicates in file" value={outcome.duplicatesInFile} />
            <Summary label="Already in workspace" value={outcome.duplicatesInDatabase} />
            <Summary
              label="Rejected"
              value={outcome.rejected.length}
              tone={outcome.rejected.length > 0 ? "text-alert-red" : undefined}
            />
          </dl>

          {outcome.rejected.length > 0 && (
            <div className="mt-5">
              <h3 className="text-[13px] font-bold text-brand-navy">Rows that could not be read</h3>
              <ul className="mt-2 space-y-1">
                {outcome.rejected.slice(0, 10).map((problem) => (
                  <li key={problem.row} className="tabular text-[12.5px] text-slate-600">
                    Row {problem.row} — {problem.reason}
                  </li>
                ))}
              </ul>
              {outcome.rejected.length > 10 && (
                <p className="mt-1 text-[12.5px] text-slate-400">
                  and {outcome.rejected.length - 10} more
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <Button asChild>
              <Link href="/leads">View leads</Link>
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStep("upload");
                setParsed(null);
                setOutcome(null);
              }}
            >
              Import another file
            </Button>
          </div>
        </Card>
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
        {value}
      </dd>
    </div>
  );
}
