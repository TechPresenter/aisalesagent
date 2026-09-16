"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageTitle } from "@/components/shared/page-title";
import { PermissionGate } from "@/components/shared/permission-gate";
import { FollowUpsStatsStrip } from "@/components/followups/follow-ups-stats";
import { FollowUpsView } from "@/components/followups/follow-ups-view";
import { AddFollowUpDialog } from "@/components/followups/add-follow-up-dialog";
import { cn } from "@/lib/utils";

/** Feature List §10 — Follow-ups & Tasks. */
export function FollowUpsScreen() {
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
        title="Follow-ups"
        subtitle="Track and manage all your follow-ups to convert more leads."
        actions={
          <PermissionGate permission="followups.manage">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-11 items-center gap-2 rounded-btn bg-brand-green px-5 text-[14.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#15A45D]"
            >
              <Plus className="h-4 w-4" strokeWidth={2.6} />
              Add Follow-up
            </button>
          </PermissionGate>
        }
      />

      <FollowUpsStatsStrip refreshKey={refreshKey} />

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

      <FollowUpsView
        refreshKey={refreshKey}
        onChanged={refresh}
        onError={(text) => setNotice({ tone: "bad", text })}
      />

      <AddFollowUpDialog open={adding} onClose={() => setAdding(false)} onCreated={refresh} />
    </>
  );
}
