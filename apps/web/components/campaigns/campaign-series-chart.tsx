"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TONE_HEX } from "@/lib/status";

export interface SeriesPoint {
  date: string;
  calls: number;
  connected: number;
  conversions: number;
}

/**
 * The 30-day campaign activity chart.
 *
 * Renders only the days the API returned. Filling gaps with zeroes would draw a line
 * plunging to the axis on days nobody called, which reads as a collapse in performance
 * rather than as a weekend.
 */
export function CampaignSeriesChart({ series }: { series: SeriesPoint[] }) {
  if (series.length === 0) {
    return (
      <p className="py-10 text-center text-[12.5px] text-slate-500">
        No campaign calls in the last 30 days.
      </p>
    );
  }

  return (
    <>
      <span className="mb-2 flex flex-wrap items-center gap-3.5 text-[11.5px] text-slate-500">
        <Legend color={TONE_HEX.blue} label="Calls" />
        <Legend color={TONE_HEX.green} label="Connected" />
        <Legend color={TONE_HEX.purple} label="Conversions" />
      </span>

      <ResponsiveContainer width="100%" height={168}>
        <AreaChart data={series} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
          <defs>
            {(["calls", "connected", "conversions"] as const).map((key, i) => (
              <linearGradient key={key} id={`campaign-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={[TONE_HEX.blue, TONE_HEX.green, TONE_HEX.purple][i]}
                  stopOpacity={0.22}
                />
                <stop
                  offset="100%"
                  stopColor={[TONE_HEX.blue, TONE_HEX.green, TONE_HEX.purple][i]}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F4" vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "#919BA5" }}
            tickFormatter={(value: string) =>
              new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            }
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "#919BA5" }}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid #E2E8F0",
              fontSize: 12,
              boxShadow: "0 4px 14px rgba(15,35,55,0.10)",
            }}
            labelFormatter={(value: string) =>
              new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            }
          />
          <Area
            type="monotone"
            dataKey="calls"
            name="Calls"
            stroke={TONE_HEX.blue}
            strokeWidth={2}
            fill="url(#campaign-calls)"
          />
          <Area
            type="monotone"
            dataKey="connected"
            name="Connected"
            stroke={TONE_HEX.green}
            strokeWidth={2}
            fill="url(#campaign-connected)"
          />
          <Area
            type="monotone"
            dataKey="conversions"
            name="Conversions"
            stroke={TONE_HEX.purple}
            strokeWidth={2}
            fill="url(#campaign-conversions)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
