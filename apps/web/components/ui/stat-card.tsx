import type { LucideIcon } from "lucide-react";
import { TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/sparkline";
import { cn, formatNumber } from "@/lib/utils";
import { TONE_HEX, type Tone } from "@/lib/status";

interface StatCardProps {
  label: string;
  /**
   * A number is thousands-separated; a string is printed verbatim. The string case is
   * for the KPIs that are not counts — "02:14" for an average duration, "2.4 GB" for
   * storage — which would otherwise need their own card component for no other reason.
   */
  value: number | string;
  trend?: number;
  sparkline: number[];
  icon: LucideIcon;
  tone: Tone;
}

/**
 * Brand Guidelines §5 (Cards): icon in a 12% tint circle of its semantic colour, bold
 * stat number, label, coloured trend arrow, inline sparkline.
 */
export function StatCard({ label, value, trend, sparkline, icon: Icon, tone }: StatCardProps) {
  const hex = TONE_HEX[tone];

  return (
    <Card className="flex items-center gap-3 p-4 transition-shadow hover:shadow-card-hover">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${hex}1F` }}
      >
        <Icon className="h-[21px] w-[21px]" strokeWidth={1.9} style={{ color: hex }} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="tabular text-[26px] font-bold leading-none tracking-tight text-brand-navy">
            {typeof value === "number" ? formatNumber(value) : value}
          </span>
          {trend !== undefined && (
            <span
              className={cn(
                "tabular inline-flex items-center gap-0.5 text-[11.5px] font-semibold",
                trend >= 0 ? "text-brand-green" : "text-alert-red",
              )}
            >
              <TrendingUp
                className={cn("h-3 w-3", trend < 0 && "rotate-180")}
                strokeWidth={2.4}
              />
              {Math.abs(trend)}%
            </span>
          )}
        </div>
        {/* Wraps rather than truncates: "Leads Found by AI" must stay readable in a
            five-across row, and an ellipsis on a KPI label tells the reader nothing. */}
        <p className="mt-1 text-[12px] leading-tight text-slate-500">{label}</p>
      </div>

      <Sparkline data={sparkline} color={hex} width={54} className="hidden self-end xl:block" />
    </Card>
  );
}
