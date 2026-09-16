import type { LucideIcon } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import type { Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

export interface StatSpec {
  id: string;
  label: string;
  /** A string value renders verbatim — for durations and sizes that are not counts. */
  value: number | string;
  trend?: number;
  sparkline: number[];
  icon: LucideIcon;
  tone: Tone;
}

/**
 * The KPI row at the top of every workspace page. Column count is passed in because the
 * screens differ — five on Leads and AI Calling, four on Recordings, three on Find Leads.
 */
export function StatStrip({ stats, columns = 5 }: { stats: StatSpec[]; columns?: 3 | 4 | 5 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2",
        columns === 3 && "xl:grid-cols-3",
        columns === 4 && "xl:grid-cols-4",
        columns === 5 && "xl:grid-cols-5",
      )}
    >
      {stats.map((stat) => (
        <StatCard
          key={stat.id}
          label={stat.label}
          value={stat.value}
          trend={stat.trend}
          sparkline={stat.sparkline}
          icon={stat.icon}
          tone={stat.tone}
        />
      ))}
    </div>
  );
}
