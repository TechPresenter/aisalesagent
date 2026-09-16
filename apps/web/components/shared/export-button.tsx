"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { ApiError, callsApi, recordingsApi, transcriptsApi } from "@/lib/api-client";
import { downloadCsv, fetchAll, toCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";

export type ExportKind = "calls" | "recordings" | "transcripts";

/**
 * What each screen exports. Kept here, keyed by name, because the page headers that hold
 * these buttons are server components and cannot hand a client component a function.
 */
const EXPORTS: Record<ExportKind, { filename: string; build: () => Promise<string> }> = {
  calls: {
    filename: "calls",
    build: async () =>
      toCsv(await fetchAll((page) => callsApi.list({ page, pageSize: 200 })), [
        { header: "Date", value: (call) => call.startedAt ?? call.queuedAt },
        { header: "Lead", value: (call) => call.lead?.name },
        { header: "Contact", value: (call) => call.lead?.contactPerson },
        { header: "City", value: (call) => call.lead?.city },
        { header: "Phone", value: (call) => call.phone },
        { header: "Status", value: (call) => call.status },
        { header: "Outcome", value: (call) => call.outcome },
        { header: "Duration (seconds)", value: (call) => call.durationSeconds },
        { header: "AI Agent", value: (call) => call.aiAgent?.name },
        { header: "Campaign", value: (call) => call.campaign?.name },
        { header: "Credits", value: (call) => call.creditsUsed },
        { header: "Recorded", value: (call) => (call.recording ? "Yes" : "No") },
        { header: "Summary", value: (call) => call.transcript?.summary },
      ]),
  },
  recordings: {
    filename: "recordings",
    build: async () =>
      toCsv(await fetchAll((page) => recordingsApi.list({ page, pageSize: 200 })), [
        { header: "Date", value: (rec) => rec.call?.startedAt ?? rec.createdAt },
        { header: "Lead", value: (rec) => rec.call?.lead?.name },
        { header: "Phone", value: (rec) => rec.call?.phone },
        { header: "Outcome", value: (rec) => rec.call?.outcome },
        { header: "AI Agent", value: (rec) => rec.call?.aiAgent?.name },
        { header: "Campaign", value: (rec) => rec.call?.campaign?.name },
        { header: "Duration (seconds)", value: (rec) => rec.durationSeconds },
        { header: "Size (bytes)", value: (rec) => rec.sizeBytes },
        { header: "Format", value: (rec) => rec.mimeType },
        { header: "Expires", value: (rec) => rec.expiresAt },
      ]),
  },
  transcripts: {
    // One row per transcript with its AI summary; the full text of each is a separate
    // request, which is what the transcript's own Copy / Download is for.
    filename: "transcripts",
    build: async () =>
      toCsv(await fetchAll((page) => transcriptsApi.list({ page, pageSize: 100 })), [
        { header: "Date", value: (t) => t.call?.startedAt ?? t.createdAt },
        { header: "Lead", value: (t) => t.call?.lead?.name },
        { header: "Phone", value: (t) => t.call?.phone },
        { header: "AI Agent", value: (t) => t.call?.aiAgent?.name },
        { header: "Campaign", value: (t) => t.call?.campaign?.name },
        { header: "Outcome", value: (t) => t.call?.outcome },
        { header: "Sentiment", value: (t) => t.sentiment },
        { header: "Language", value: (t) => t.language },
        { header: "Summary", value: (t) => t.summary },
      ]),
  },
};

/** A header button that downloads the screen's records as CSV. */
export function ExportButton({
  kind,
  label,
  className,
}: {
  kind: ExportKind;
  label: string;
  className: string;
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setExporting(true);
    setError(null);
    try {
      const { filename, build } = EXPORTS[kind];
      downloadCsv(`${filename}-${new Date().toISOString().slice(0, 10)}.csv`, await build());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-[12px] font-medium text-[#C93B3B]">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void run()}
        disabled={exporting}
        className={cn(className, "disabled:cursor-wait disabled:opacity-70")}
      >
        {exporting ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
        ) : (
          <Download className="h-4 w-4" strokeWidth={2.2} />
        )}
        {exporting ? "Exporting…" : label}
      </button>
    </span>
  );
}
