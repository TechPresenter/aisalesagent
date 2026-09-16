"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, CheckCircle2, PhoneCall, Search, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  CallOutcomesCard,
  CallsTrendCard,
  LeadSourcesCard,
} from "@/components/dashboard/chart-cards";
import { LiveCallsSection } from "@/components/dashboard/live-calls-section";
import { RecentLeadsCard } from "@/components/dashboard/recent-leads-card";
import { SalesNotesCard } from "@/components/dashboard/sales-notes-card";
import { loadDashboard, type DashboardData } from "@/lib/dashboard-data";
import type { Tone } from "@/lib/status";

/**
 * Each stat card's icon colour is its semantic tone, not decoration: green for the
 * positive outcome, purple for the AI-sourced count, per Brand Guidelines §6.
 */
const STAT_STYLE: Record<string, { icon: typeof PhoneCall; tone: Tone }> = {
  "total-calls": { icon: PhoneCall, tone: "blue" },
  talked: { icon: Users, tone: "purple" },
  interested: { icon: CheckCircle2, tone: "green" },
  "demo-booked": { icon: CalendarCheck, tone: "blue" },
  "ai-leads": { icon: Search, tone: "purple" },
};

/**
 * Build Plan Phase 3 — the dashboard grid, in the order the spec fixes it: five stat
 * cards, then the three charts, then Live Calls beside the live-call panel, then Recent
 * Leads beside AI Sales Notes. Every figure is read from the API; the seed set only
 * stands in while the API is unreachable, and the page says when it does.
 */
export function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadDashboard().then(setData, () => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader />

      {data?.source === "seed" && (
        <p className="mb-4 rounded-btn bg-warning-amber/[0.1] px-4 py-2.5 text-[13px] font-medium text-[#B4761A]">
          Showing sample data — the API is not reachable.
        </p>
      )}

      {failed && (
        <Card className="mb-4 px-4 py-3 text-[13px] text-slate-500">
          Could not load the dashboard.
          <button
            type="button"
            onClick={load}
            className="ml-2 font-semibold text-accent-blue hover:underline"
          >
            Try again
          </button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {data
          ? data.kpis.map((stat) => (
              <StatCard
                key={stat.id}
                label={stat.label}
                value={stat.value}
                trend={stat.trend}
                sparkline={stat.sparkline}
                icon={STAT_STYLE[stat.id].icon}
                tone={STAT_STYLE[stat.id].tone}
              />
            ))
          : Object.keys(STAT_STYLE).map((id) => (
              <Card key={id} className="flex items-center gap-3 p-4">
                <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-100" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-6 w-16 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                </div>
              </Card>
            ))}
      </div>

      {/* Equal thirds: a wider trend column squeezes both donut legends into ellipses,
          and a legend that cannot show "Not Interested" in full is not a legend. */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <CallOutcomesCard data={data?.outcomes ?? []} />
        <CallsTrendCard data={data?.trend ?? []} secondLabel={data?.trendSecondLabel ?? "Connected"} />
        <LeadSourcesCard data={data?.sources ?? []} />
      </div>

      <div className="mt-5">
        <LiveCallsSection />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]">
        <RecentLeadsCard leads={data?.recentLeads ?? []} loading={!data && !failed} />
        <SalesNotesCard note={data?.latestNote ?? null} loading={!data && !failed} />
      </div>
    </>
  );
}
