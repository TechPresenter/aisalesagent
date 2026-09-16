import type { Metadata } from "next";
import { PageTitle } from "@/components/shared/page-title";
import { ExportButton } from "@/components/shared/export-button";
import { TranscriptsView } from "@/components/calls/transcripts-view";
import { TranscriptsStatsStrip } from "@/components/calls/transcripts-stats";

export const metadata: Metadata = { title: "Transcripts · AI Sales Agent" };

/** Feature List §7 — Transcripts. */
export default function TranscriptsPage() {
  return (
    <>
      <PageTitle
        title="Transcripts"
        subtitle="View, search and manage all call transcripts with AI summaries."
        actions={
          <ExportButton
            kind="transcripts"
            label="Export Transcripts"
            className="inline-flex h-11 items-center gap-2 rounded-btn bg-accent-blue px-5 text-[14.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1B6CD8]"
          />
        }
      />

      <TranscriptsStatsStrip />

      <TranscriptsView />
    </>
  );
}
