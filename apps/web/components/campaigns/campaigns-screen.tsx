"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageTitle } from "@/components/shared/page-title";
import { CampaignStatsStrip } from "@/components/campaigns/campaign-stats-strip";
import { CampaignsView } from "@/components/campaigns/campaigns-view";
import { NewCampaignDialog } from "@/components/campaigns/new-campaign-dialog";

/**
 * Feature List §4 — Campaigns. Holds the create dialog beside the list it adds to, so a
 * new campaign appears in the table and the totals as soon as it is created.
 */
export function CampaignsScreen({ startCreating = false }: { startCreating?: boolean }) {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(startCreating);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const close = useCallback(() => {
    setCreating(false);
    // Opened from the dashboard's link; drop the flag so a reload does not reopen it.
    if (startCreating) router.replace("/campaigns");
  }, [router, startCreating]);

  const created = useCallback((message: string) => {
    setNotice(message);
    setRefreshKey((n) => n + 1);
  }, []);

  return (
    <>
      <PageTitle
        title="Campaigns"
        subtitle="Create, manage, and track your outreach campaigns."
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-11 items-center gap-2 rounded-btn bg-brand-green px-5 text-[14.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#15A45D]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            New Campaign
          </button>
        }
      />

      {/* Keyed so the totals are read again after a campaign is created. */}
      <CampaignStatsStrip key={refreshKey} />

      {notice && (
        <div
          role="status"
          className="mb-4 rounded-btn bg-brand-green/[0.1] px-4 py-2.5 text-[13px] font-medium text-deep-green"
        >
          {notice}
        </div>
      )}

      <CampaignsView refreshKey={refreshKey} />

      <NewCampaignDialog open={creating} onClose={close} onCreated={created} />
    </>
  );
}
