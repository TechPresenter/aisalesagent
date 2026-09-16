"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, HardDrive, Hourglass, Mic } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { recordingsApi, type RecordingStats } from "@/lib/api-client";
import { formatBytes } from "@/components/calls/recordings-view";
import { formatDuration } from "@/lib/utils";

/**
 * Recordings KPI strip.
 *
 * "Expiring soon" is here because retention is otherwise invisible until it deletes
 * something — a workspace on a seven-day plan should be able to see what it is about to
 * lose while it can still act on it.
 */
export function RecordingsStatsStrip() {
  const [stats, setStats] = useState<RecordingStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    recordingsApi
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
        Could not load recording totals. The rest of the page still works.
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

  const cards = [
    { label: "Recordings", value: stats?.total ?? 0, icon: Mic, tone: "blue" as const },
    {
      label: "Total Duration",
      value: stats ? formatDuration(stats.totalDurationSeconds) : "—",
      icon: Clock,
      tone: "purple" as const,
    },
    {
      label: "Storage Used",
      value: stats ? formatBytes(stats.storageBytes) : "—",
      icon: HardDrive,
      tone: "green" as const,
    },
    {
      label: "Expiring in 7 Days",
      value: stats?.expiringSoon ?? 0,
      icon: Hourglass,
      tone: "amber" as const,
    },
  ];

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
