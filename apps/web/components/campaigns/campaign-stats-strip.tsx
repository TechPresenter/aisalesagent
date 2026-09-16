"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Megaphone, PhoneCall, Play, Users } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { campaignsApi, type CampaignOverview } from "@/lib/api-client";
import type { Tone } from "@/lib/status";

/**
 * The Campaigns KPI strip, counted in the database.
 *
 * As on Leads, there are no trend arrows: a trend needs a prior period to compare
 * against, and the API does not compute one. A made-up percentage next to a real number
 * makes the real number look invented too.
 */
const CARDS: { key: keyof CampaignOverview; label: string; icon: typeof Users; tone: Tone }[] = [
  { key: "totalCampaigns", label: "Total Campaigns", icon: Megaphone, tone: "purple" },
  { key: "activeCampaigns", label: "Active Campaigns", icon: Play, tone: "blue" },
  { key: "leadsReached", label: "Leads in Campaigns", icon: CheckCircle2, tone: "green" },
  { key: "callsMade", label: "Calls Made", icon: PhoneCall, tone: "amber" },
  { key: "conversions", label: "Demos Booked", icon: Users, tone: "purple" },
];

export function CampaignStatsStrip() {
  const [overview, setOverview] = useState<CampaignOverview | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    campaignsApi
      .overview()
      .then((next) => {
        if (!cancelled) setOverview(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  if (failed) {
    return (
      <Card className="mb-5 px-4 py-3 text-[13px] text-slate-500">
        Could not load campaign totals. The rest of the page still works.
        <button
          type="button"

          onClick={() => load()}

          className="ml-2 font-semibold text-accent-blue hover:underline"
        >
          Try again
        </button>
      </Card>
    );
  }

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {CARDS.map(({ key, label, icon, tone }) =>
        overview ? (
          <StatCard
            key={key}
            label={label}
            value={overview[key] as number}
            sparkline={[]}
            icon={icon}
            tone={tone}
          />
        ) : (
          <Card key={key} className="flex items-center gap-3 p-4">
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-6 w-16 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
            </div>
          </Card>
        ),
      )}
    </div>
  );
}
