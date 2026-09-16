"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarCheck, CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { followUpsApi, type FollowUpStats } from "@/lib/api-client";
import type { Tone } from "@/lib/status";

/**
 * Follow-ups KPI strip.
 *
 * "Overdue" and "Today" come from the API rather than being counted in the browser: both
 * are readings of the clock, and the workspace's timezone — not the viewer's — is what
 * decides them. A rep travelling must not see a different overdue count from the manager
 * sitting at the office.
 */
export function FollowUpsStatsStrip({ refreshKey = 0 }: { refreshKey?: number }) {
  const [stats, setStats] = useState<FollowUpStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    followUpsApi
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

  useEffect(() => load(), [load, refreshKey]);

  if (failed) {
    return (
      <Card className="mb-5 px-4 py-3 text-[13px] text-slate-500">
        Could not load follow-up totals. The rest of the page still works.
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

  const cards: { label: string; value: number; icon: typeof Clock; tone: Tone }[] = [
    { label: "Total Follow-ups", value: stats?.total ?? 0, icon: CalendarDays, tone: "blue" },
    // "Open" rather than "Upcoming": this is every follow-up nobody has closed,
    // which includes the overdue and due-today ones counted separately to its right. The
    // filter bar's "Upcoming" means strictly future, and giving two controls the same word
    // for different sets is how a screen stops adding up.
    { label: "Open", value: stats?.pending ?? 0, icon: Clock, tone: "amber" },
    { label: "Completed", value: stats?.completed ?? 0, icon: CheckCircle2, tone: "green" },
    { label: "Overdue", value: stats?.overdue ?? 0, icon: AlertCircle, tone: "red" },
    { label: "Due Today", value: stats?.today ?? 0, icon: CalendarCheck, tone: "blue" },
  ];

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map(({ label, value, icon, tone }) =>
        stats ? (
          <StatCard key={label} label={label} value={value} sparkline={[]} icon={icon} tone={tone} />
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
