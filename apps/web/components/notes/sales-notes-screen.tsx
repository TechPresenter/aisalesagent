"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageTitle } from "@/components/shared/page-title";
import { NotesStatsStrip } from "@/components/notes/notes-stats-strip";
import { SalesNotesView } from "@/components/notes/sales-notes-view";
import { AddNoteDialog } from "@/components/notes/add-note-dialog";
import { PermissionGate } from "@/components/shared/permission-gate";
import { cn } from "@/lib/utils";

/**
 * Owns the state the three pieces of this screen share: a counter that makes the list and
 * the KPI strip reload together after a write, and the confirmation banner. Kept here
 * rather than in the list so that creating a note from the header updates the totals too
 * — a stat strip that disagrees with the list under it is worse than no stat strip.
 */
export function SalesNotesScreen() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refresh = (message: string) => {
    setNotice({ tone: "ok", text: message });
    setRefreshKey((n) => n + 1);
  };

  return (
    <>
      <PageTitle
        title="Sales Notes"
        subtitle="Capture, organize and manage notes from your calls to close more deals."
        actions={
          <PermissionGate permission="notes.create">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-11 items-center gap-2 rounded-btn bg-accent-blue px-5 text-[14.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1B6CD8]"
            >
              <Plus className="h-4 w-4" strokeWidth={2.6} />
              Add Note
            </button>
          </PermissionGate>
        }
      />

      <NotesStatsStrip refreshKey={refreshKey} />

      {notice && (
        <div
          role="status"
          className={cn(
            "mb-4 rounded-btn px-4 py-2.5 text-[13px] font-medium",
            notice.tone === "ok"
              ? "bg-brand-green/[0.1] text-deep-green"
              : "bg-alert-red/[0.09] text-[#C93B3B]",
          )}
        >
          {notice.text}
        </div>
      )}

      <SalesNotesView
        refreshKey={refreshKey}
        onChanged={refresh}
        onError={(text) => setNotice({ tone: "bad", text })}
      />

      <AddNoteDialog open={adding} onClose={() => setAdding(false)} onCreated={refresh} />
    </>
  );
}
