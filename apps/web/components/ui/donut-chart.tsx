"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatNumber } from "@/lib/utils";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutSlice[];
  /** Rendered in the hole — the total plus what it counts. */
  centerValue: number;
  centerLabel: string;
  size?: number;
}

/**
 * Brand Guidelines §5 (Charts): donuts carry composition/breakdown, and slice colours
 * come from the semantic palette so a colour means the same thing in every chart on the
 * page. Callers pass the colour in from `TONE_HEX` rather than picking one here.
 */
export function DonutChart({ data, centerValue, centerLabel, size = 140 }: DonutChartProps) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="66%"
            outerRadius="100%"
            paddingAngle={1.5}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((slice) => (
              <Cell key={slice.label} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip
            cursor={false}
            contentStyle={{
              borderRadius: 10,
              border: "1px solid #E2E8F0",
              boxShadow: "0 4px 14px rgba(15,35,55,0.10)",
              fontSize: 12,
              padding: "6px 10px",
            }}
            formatter={(value: number, name: string) => [
              `${formatNumber(value)} (${total ? Math.round((value / total) * 100) : 0}%)`,
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Centred over the hole rather than drawn as SVG text, so it inherits the page
          font stack and tabular figures like every other number in the UI. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[22px] font-bold leading-none text-brand-navy">
          {formatNumber(centerValue)}
        </span>
        <span className="mt-1 text-[11px] text-slate-500">{centerLabel}</span>
      </div>
    </div>
  );
}

/** The colour key beside the donut: swatch, label, count and share. */
export function DonutLegend({ data }: { data: DonutSlice[] }) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <ul className="flex min-w-0 flex-1 flex-col justify-center gap-2">
      {data.map((slice) => (
        <li key={slice.label} className="flex items-center gap-2 text-[12px]">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: slice.color }}
          />
          <span className="min-w-0 flex-1 text-slate-600">{slice.label}</span>
          <span className="tabular shrink-0 font-semibold text-brand-navy">
            {formatNumber(slice.value)}
            <span className="ml-1 font-normal text-slate-400">
              ({total ? Math.round((slice.value / total) * 100) : 0}%)
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
