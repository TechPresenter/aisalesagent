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

interface TrendChartProps {
  data: { date: string; total: number; interested: number }[];
  height?: number;
}

/**
 * Brand Guidelines §5 (Charts): "Line/area charts with soft gradient fill for trends
 * over time." Blue is the total series and green the interested series, matching the
 * meaning those two colours carry in every badge and donut on the page.
 */
export function TrendChart({ data, height = 210 }: TrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#237DF5" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#237DF5" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fillInterested" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#19B969" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#19B969" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid stroke="#EDF1F5" vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "#94A3B8", fontSize: 11 }}
          // 31 daily points would collide; show roughly one label a week.
          interval={6}
          dy={6}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fill: "#94A3B8", fontSize: 11 }}
          width={44}
        />
        <Tooltip
          cursor={{ stroke: "#CBD5E1", strokeWidth: 1 }}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #E2E8F0",
            boxShadow: "0 4px 14px rgba(15,35,55,0.10)",
            fontSize: 12,
            padding: "8px 10px",
          }}
        />
        {/* Animation off on purpose: this series is repainted whenever the date range or
            the live feed changes, and replaying a grow-from-zero sweep on every push
            reads as a glitch rather than as motion. It also keeps the chart correct in
            contexts where rAF is throttled, which is what drives react-smooth. */}
        <Area
          type="monotone"
          dataKey="total"
          name="Total Calls"
          stroke="#237DF5"
          strokeWidth={2}
          fill="url(#fillTotal)"
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0 }}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="interested"
          name="Interested"
          stroke="#19B969"
          strokeWidth={2}
          fill="url(#fillInterested)"
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
