import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart, DonutLegend, type DonutSlice } from "@/components/ui/donut-chart";
import { TrendChart } from "@/components/ui/trend-chart";
import { CALL_OUTCOME, LEAD_SOURCE, TONE_HEX } from "@/lib/status";
import type { CallOutcome, LeadSource } from "@/lib/types";

/** Feature List §1 — Call Outcomes donut. */
export function CallOutcomesCard({ data }: { data: { outcome: CallOutcome; value: number }[] }) {
  const slices: DonutSlice[] = data.map(({ outcome, value }) => ({
    label: CALL_OUTCOME[outcome].label,
    value,
    color: TONE_HEX[CALL_OUTCOME[outcome].tone],
  }));

  return (
    <DonutCard
      title="Call Outcomes"
      slices={slices}
      centerLabel="Total Calls"
      empty="No call outcomes recorded yet."
    />
  );
}

/** Feature List §1 — Lead Sources donut (Your Upload vs AI Found, and the rest). */
export function LeadSourcesCard({ data }: { data: { source: LeadSource; value: number }[] }) {
  const slices: DonutSlice[] = data.map(({ source, value }) => ({
    label: LEAD_SOURCE[source].label,
    value,
    color: TONE_HEX[LEAD_SOURCE[source].tone],
  }));

  return (
    <DonutCard title="Lead Sources" slices={slices} centerLabel="Total Leads" empty="No leads yet." />
  );
}

function DonutCard({
  title,
  slices,
  centerLabel,
  empty,
}: {
  title: string;
  slices: DonutSlice[];
  centerLabel: string;
  empty: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-5 pt-4">
        {total === 0 ? (
          <p className="w-full py-12 text-center text-[13px] text-slate-400">{empty}</p>
        ) : (
          <>
            <DonutChart data={slices} centerValue={total} centerLabel={centerLabel} />
            <DonutLegend data={slices} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Feature List §1 — Calls Trend: total calls against a second series, per day. */
export function CallsTrendCard({
  data,
  secondLabel,
}: {
  data: { date: string; total: number; interested: number }[];
  secondLabel: string;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Calls Trend</CardTitle>
        <div className="flex shrink-0 items-center gap-4 text-[11.5px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent-blue" />
            Total Calls
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand-green" />
            {secondLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <TrendChart data={data} />
      </CardContent>
    </Card>
  );
}
