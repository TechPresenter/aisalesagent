"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, PhoneCall, PhoneMissed, Users } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { callsApi, type CallHistoryStats } from "@/lib/api-client";
import { formatDuration } from "@/lib/utils";
import type { Tone } from "@/lib/status";

/**
 * Call History's KPI strip, counted in the database.
 *
 * Average duration is over connected calls only — including the zero-second no-answers
 * would drag the mean toward zero and make a healthy call list look broken.
 */
export function CallHistoryStatsStrip() {
  const [stats, setStats] = useState<CallHistoryStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    callsApi
      .historyStats()
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
        Could not load call totals. The rest of the page still works.
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

  const cards: { label: string; value: number | string; icon: typeof Users; tone: Tone }[] = [
    { label: "Total Calls", value: stats?.total ?? 0, icon: PhoneCall, tone: "blue" },
    { label: "Connected", value: stats?.connected ?? 0, icon: CheckCircle2, tone: "green" },
    { label: "Interested", value: stats?.interested ?? 0, icon: Users, tone: "purple" },
    { label: "Not Reached", value: stats?.missed ?? 0, icon: PhoneMissed, tone: "amber" },
    {
      label: "Avg. Duration",
      value: stats ? formatDuration(stats.avgDurationSeconds) : "—",
      icon: Clock,
      tone: "gray",
    },
  ];

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map(({ label, value, icon, tone }) =>
        stats ? (
          <StatCard
            key={label}
            label={label}
            value={value}
            sparkline={[]}
            icon={icon}
            tone={tone}
          />
        ) : (
          <Card key={label} className="flex items-center gap-3 p-4">
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
