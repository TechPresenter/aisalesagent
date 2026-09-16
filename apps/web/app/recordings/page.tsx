import type { Metadata } from "next";
import { PageTitle } from "@/components/shared/page-title";
import { ExportButton } from "@/components/shared/export-button";
import { RecordingsView } from "@/components/calls/recordings-view";
import { RecordingsStatsStrip } from "@/components/calls/recordings-stats";

export const metadata: Metadata = { title: "Recordings · AI Sales Agent" };

/** Feature List §7 — Recordings. */
export default function RecordingsPage() {
  return (
    <>
      <PageTitle
        title="Call Recordings"
        subtitle="Listen, review and manage all AI agent call recordings."
        actions={
          <ExportButton
            kind="recordings"
            label="Export Recordings"
            className="inline-flex h-11 items-center gap-2 rounded-btn border border-slate-200 bg-surface px-5 text-[14.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
          />
        }
      />

      <RecordingsStatsStrip />

      <RecordingsView />
    </>
  );
}
