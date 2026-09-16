import type { Metadata } from "next";
import { PageTitle } from "@/components/shared/page-title";
import { ExportButton } from "@/components/shared/export-button";
import { CallHistoryView } from "@/components/calls/call-history-view";
import { CallHistoryStatsStrip } from "@/components/calls/call-history-stats";

export const metadata: Metadata = { title: "Call History · AI Sales Agent" };

/** Feature List §6 — Call History. */
export default function CallHistoryPage() {
  return (
    <>
      <PageTitle
        title="Call History"
        subtitle="View and manage all calls made by AI agents and team members."
        actions={
          <ExportButton
            kind="calls"
            label="Export Calls"
            className="inline-flex h-11 items-center gap-2 rounded-btn border border-slate-200 bg-surface px-5 text-[14.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
          />
        }
      />

      <CallHistoryStatsStrip />

      <CallHistoryView />
    </>
  );
}
