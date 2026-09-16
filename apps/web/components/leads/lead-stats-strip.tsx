"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, CheckCircle2, Clock, Sparkles, Users } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { leadsApi, type LeadStats } from "@/lib/api-client";
import type { Tone } from "@/lib/status";

/**
 * The KPI strip above the leads table, counted in the database.
 *
 * These were hardcoded, and a hardcoded KPI is worse than no KPI: it looks authoritative
 * and is wrong the moment anyone adds a lead. They are counts over the whole workspace,
 * not over the page the table happens to be showing, so they have to come from their own
 * endpoint rather than from the list response.
 *
 * Trend arrows are deliberately absent. A trend needs a prior period to compare against
 * and the API does not compute one yet; inventing a percentage would be the same lie in
 * a smaller font.
 */
const CARDS: {
  key: keyof LeadStats;
  label: string;
  icon: typeof Users;
  tone: Tone;
}[] = [
  { key: "total", label: "Total Leads", icon: Users, tone: "purple" },
  { key: "newToday", label: "New Today", icon: Sparkles, tone: "blue" },
  { key: "interested", label: "Interested", icon: CheckCircle2, tone: "green" },
  { key: "followUpsDue", label: "Follow-ups Due", icon: Clock, tone: "amber" },
  { key: "demoBooked", label: "Demo Booked", icon: CalendarCheck, tone: "blue" },
];

export function LeadStatsStrip() {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    leadsApi
      .stats()
      .then((next) => {
        if (!cancelled) setStats(next);
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
        Could not load lead totals. The rest of the page still works.
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
        stats ? (
          <StatCard
            key={key}
            label={label}
            value={stats[key]}
            sparkline={[]}
            icon={icon}
            tone={tone}
          />
        ) : (
          <StatCardSkeleton key={key} />
        ),
      )}
    </div>
  );
}

/** Matches StatCard's height and padding so the strip does not jump when data lands. */
function StatCardSkeleton() {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-100" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-6 w-16 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
      </div>
    </Card>
  );
}
