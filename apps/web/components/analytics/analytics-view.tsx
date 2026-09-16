"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, CalendarDays, Clock, Target, TrendingUp, Users } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart, DonutLegend, type DonutSlice } from "@/components/ui/donut-chart";
import { TrendChart } from "@/components/ui/trend-chart";
import { LeadFunnel } from "@/components/analytics/lead-funnel";
import type { AgentPerformance, AnalyticsData, Insight, RankedRow } from "@/lib/analytics-data";
import { CALL_OUTCOME, LEAD_SOURCE, TONE_HEX, type Tone } from "@/lib/status";
import { cn, formatNumber } from "@/lib/utils";

const INSIGHT_ICON: Record<Insight["icon"], typeof TrendingUp> = {
  trend: TrendingUp,
  users: Users,
  calendar: CalendarDays,
  target: Target,
  clock: Clock,
};

/**
 * Feature List §11 — Analytics, against the workspace's own figures.
 *
 * Presentational: every number arrives as a prop from `loadAnalytics`, so the charts and
 * the insight list beside them are read off one set of counts and cannot disagree.
 */
export function AnalyticsView({ data, loading }: { data: AnalyticsData | null; loading: boolean }) {
  const sourceSlices: DonutSlice[] = (data?.sources ?? []).map(({ source, value }) => ({
    label: LEAD_SOURCE[source].label,
    value,
    color: TONE_HEX[LEAD_SOURCE[source].tone],
  }));
  const outcomeSlices: DonutSlice[] = (data?.outcomes ?? []).map(({ outcome, value }) => ({
    label: CALL_OUTCOME[outcome].label,
    value,
    color: TONE_HEX[CALL_OUTCOME[outcome].tone],
  }));

  const totalLeads = sourceSlices.reduce((sum, slice) => sum + slice.value, 0);
  const totalOutcomes = outcomeSlices.reduce((sum, slice) => sum + slice.value, 0);
  const agents = data?.agents ?? [];
  const hours = data?.hours ?? [];
  const busiestHour = Math.max(1, ...hours.map((entry) => entry.calls));
  const empty = loading ? "Loading…" : "Nothing to show yet.";

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-5">
          <CardHeader className="p-0">
            <CardTitle>Calls Trend</CardTitle>
            <span className="flex shrink-0 items-center gap-3.5 text-[12px] text-slate-500">
              <LegendDot color={TONE_HEX.blue} label="Total Calls" />
              <LegendDot color={TONE_HEX.green} label={data?.trendSecondLabel ?? "Connected"} />
            </span>
          </CardHeader>
          <div className="mt-3">
            {data && data.trend.length > 0 ? (
              <TrendChart data={data.trend} height={200} />
            ) : (
              <EmptyPanel height={200} message={empty} />
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <CardTitle>Lead Sources</CardTitle>
          <div className="mt-4 flex flex-wrap items-center gap-5">
            {totalLeads === 0 ? (
              <EmptyPanel height={140} message={loading ? "Loading…" : "No leads yet."} />
            ) : (
              <>
                <DonutChart
                  data={sourceSlices}
                  centerValue={totalLeads}
                  centerLabel="Total Leads"
                />
                <ul className="min-w-0 flex-1 space-y-3">
                  {sourceSlices.map((slice) => (
                    <li key={slice.label} className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: slice.color }}
                        />
                        <span className="truncate text-[13px] font-semibold text-brand-navy">
                          {slice.label}
                        </span>
                      </span>
                      <span className="tabular mt-0.5 block pl-4.5 text-[13px] text-slate-500">
                        {formatNumber(slice.value)} (
                        {Math.round((slice.value / totalLeads) * 100)}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <CardTitle>Call Outcomes</CardTitle>
          <div className="mt-4 flex flex-wrap items-center gap-5">
            {totalOutcomes === 0 ? (
              <EmptyPanel
                height={140}
                message={loading ? "Loading…" : "No call outcomes recorded yet."}
              />
            ) : (
              <>
                <DonutChart
                  data={outcomeSlices}
                  centerValue={totalOutcomes}
                  centerLabel="Total Calls"
                />
                <DonutLegend data={outcomeSlices} />
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <Card className="min-w-0 p-5">
          <CardHeader className="p-0">
            <CardTitle>Agent Performance</CardTitle>
            <span className="flex shrink-0 items-center gap-3.5 text-[12px] text-slate-500">
              <LegendDot color={TONE_HEX.blue} label="Total Calls" />
              <LegendDot color={TONE_HEX.green} label="Interested" />
            </span>
          </CardHeader>

          <div className="mt-4">
            {agents.length === 0 ? (
              <EmptyPanel
                height={196}
                message={loading ? "Loading…" : "No AI agent has placed a call yet."}
              />
            ) : (
              <ResponsiveContainer width="100%" height={196}>
                <BarChart
                  data={agents}
                  margin={{ top: 18, right: 4, left: -26, bottom: 0 }}
                  barGap={4}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F4" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={<AgentTick agents={agents} />}
                    height={38}
                    interval={0}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "#919BA5" }}
                    width={44}
                    allowDecimals={false}
                  />
                  <Tooltip cursor={{ fill: "rgba(35,125,245,0.05)" }} contentStyle={TOOLTIP_STYLE} />
                  <Bar
                    dataKey="totalCalls"
                    name="Total Calls"
                    fill={TONE_HEX.blue}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={22}
                  >
                    <LabelList dataKey="totalCalls" position="top" style={LABEL_STYLE} />
                  </Bar>
                  <Bar
                    dataKey="interested"
                    name="Interested"
                    fill={TONE_HEX.green}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={22}
                  >
                    <LabelList dataKey="interested" position="top" style={LABEL_STYLE} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <RankedTable
          title="Top Performing Campaigns"
          firstColumn="Campaign Name"
          valueColumn="Calls"
          rows={data?.campaigns ?? []}
          barTone="blue"
          href="/campaigns"
          empty={loading ? "Loading…" : "No campaign has placed a call yet."}
        />

        <RankedTable
          title="Leads by City"
          firstColumn="City"
          valueColumn="Total Leads"
          rows={data?.cities ?? []}
          barTone="blue"
          href="/leads"
          empty={loading ? "Loading…" : "No leads yet."}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <Card className="min-w-0 p-5">
          <CardHeader className="p-0">
            <CardTitle>Call Time Distribution</CardTitle>
            {/* Which clock the hours are on — the workspace's calling timezone, not the
                reader's, since that is the one the call window is set in. */}
            <span className="shrink-0 text-[11.5px] text-slate-400">{data?.hoursTimezone}</span>
          </CardHeader>
          <div className="mt-4">
            {hours.every((entry) => entry.calls === 0) ? (
              <EmptyPanel
                height={200}
                message={loading ? "Loading…" : "No calls in the last 30 days."}
              />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hours} margin={{ top: 6, right: 4, left: -26, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F4" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "#919BA5" }}
                    // Every third hour: seventeen labels overlap into an unreadable band.
                    interval={2}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "#919BA5" }}
                    width={44}
                    allowDecimals={false}
                  />
                  <Tooltip cursor={{ fill: "rgba(125,85,205,0.06)" }} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="calls" name="Calls" radius={[3, 3, 0, 0]} maxBarSize={20}>
                    {/* The busiest hours carry the AI purple at full strength and the quiet
                        ones are lightened, so the peak window reads at a glance rather than
                        having to be traced along the axis. */}
                    {hours.map((entry) => (
                      <Cell
                        key={entry.hour}
                        fill={TONE_HEX.purple}
                        fillOpacity={entry.calls >= busiestHour * 0.75 ? 1 : 0.55}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <CardTitle>Lead Status Funnel</CardTitle>
          <div className="mt-4 flex flex-wrap items-center gap-6">
            {!data || data.funnel[0].value === 0 ? (
              <EmptyPanel height={200} message={loading ? "Loading…" : "No leads yet."} />
            ) : (
              <>
                <LeadFunnel stages={data.funnel} />
                <ul className="min-w-0 flex-1 space-y-2">
                  {data.funnel.map((stage) => (
                    <li key={stage.label} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: TONE_HEX[stage.tone] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-600">
                        {stage.label}
                      </span>
                      <span className="tabular shrink-0 text-[12.5px] font-semibold text-brand-navy">
                        {formatNumber(stage.value)} (
                        {Math.round((stage.value / data.funnel[0].value) * 100)}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <div className="flex items-center gap-2">
            <LightbulbIcon />
            <CardTitle>Key Insights</CardTitle>
          </div>
          {(data?.insights.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-[13px] text-slate-400">
              {loading ? "Loading…" : "Insights appear once there are calls and leads to read."}
            </p>
          ) : (
            <ul className="mt-4 space-y-3.5">
              {(data?.insights ?? []).map((insight) => {
                const Icon = INSIGHT_ICON[insight.icon];
                return (
                  <li key={insight.id} className="flex items-start gap-3">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${TONE_HEX[insight.tone]}22` }}
                    >
                      <Icon
                        className="h-4 w-4"
                        strokeWidth={2.1}
                        style={{ color: TONE_HEX[insight.tone] }}
                      />
                    </span>
                    <p className="pt-1 text-[12.5px] leading-snug text-slate-600">{insight.text}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function RankedTable({
  title,
  firstColumn,
  valueColumn,
  rows,
  barTone,
  href,
  empty,
}: {
  title: string;
  firstColumn: string;
  valueColumn: string;
  rows: RankedRow[];
  barTone: Tone;
  /** Where "View All" goes — the screen that lists these in full. */
  href: string;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-btn border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-brand-navy transition-colors hover:bg-slate-50"
        >
          View All
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </CardHeader>

      {rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-[13px] text-slate-400">{empty}</p>
      ) : (
        <div className="scrollbar-thin mt-4 overflow-x-auto">
          <table className="w-full min-w-[340px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50/80">
                {[firstColumn, valueColumn, "Interested", "Conversion"].map((header, index) => (
                  <th
                    key={header}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                      index === 0 || index === 3 ? "px-4" : "px-2",
                    )}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3 text-[12.5px] font-medium text-brand-navy">
                    <span className="block max-w-[150px] truncate">{row.label}</span>
                  </td>
                  <td className="px-2 py-3">
                    <span className="flex items-center gap-2">
                      {/* The bar is scaled against the top row, so the leader always fills
                          its track and the rest are read relative to it. */}
                      <span className="h-1.5 w-[42px] shrink-0 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${(row.value / max) * 100}%`,
                            backgroundColor: TONE_HEX[barTone],
                          }}
                        />
                      </span>
                      <span className="tabular text-[12.5px] font-semibold text-brand-navy">
                        {formatNumber(row.value)}
                      </span>
                    </span>
                  </td>
                  <td className="tabular whitespace-nowrap px-2 py-3 text-[12.5px] text-slate-600">
                    {row.interested} ({row.interestedPercent}%)
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-[12.5px] text-slate-600">
                    {row.conversions} ({row.conversionPercent}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function EmptyPanel({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex w-full items-center justify-center text-[13px] text-slate-400"
      style={{ height }}
    >
      {message}
    </div>
  );
}

const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: "1px solid #E2E8F0",
  fontSize: 12,
  boxShadow: "0 4px 14px rgba(15,35,55,0.10)",
} as const;

const LABEL_STYLE = {
  fontSize: 11,
  fontWeight: 700,
  fill: "#0F2337",
} as const;

/** Two-line agent tick: name over language, matching the reference axis. */
function AgentTick({
  x,
  y,
  payload,
  agents,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  agents: AgentPerformance[];
}) {
  const agent = agents.find((entry) => entry.name === payload?.value);

  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text textAnchor="middle" dy={12} fontSize={11} fill="#0F2337" fontWeight={500}>
        {payload?.value}
      </text>
      <text textAnchor="middle" dy={25} fontSize={10} fill="#919BA5">
        ({agent?.language ?? ""})
      </text>
    </g>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function LightbulbIcon() {
  return (
    <svg className={cn("h-4.5 w-4.5 text-warning-amber")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
