"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  Download,
  Loader2,
  PhoneCall,
  Target,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/shared/page-title";
import { StatStrip, type StatSpec } from "@/components/shared/stat-strip";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { loadAnalytics, type AnalyticsData } from "@/lib/analytics-data";
import { downloadCsv, toCsv } from "@/lib/csv-export";

/**
 * Feature List §11 — Analytics.
 *
 * The figures are counted in the database and loaded once here, then handed to the strip,
 * the charts and the report button alike — so the exported file and the screen can never
 * be two different reports.
 *
 * No trend arrows on the KPI strip: a trend needs a prior period to compare against and
 * the API does not compute one. A made-up percentage next to a real number makes the real
 * number look invented too.
 */
export function AnalyticsScreen() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadAnalytics().then(setData, () => setFailed(true));
  }, []);

  useEffect(() => load(), [load]);

  const stats: StatSpec[] = [
    {
      id: "calls",
      label: "Total Calls",
      value: data?.totals.totalCalls ?? 0,
      sparkline: data?.callsSeries ?? [],
      icon: PhoneCall,
      tone: "blue",
    },
    {
      id: "leads",
      label: "Leads Generated",
      value: data?.totals.leadsGenerated ?? 0,
      sparkline: [],
      icon: Users,
      tone: "green",
    },
    {
      id: "interested",
      label: "Interested Leads",
      value: data?.totals.interestedLeads ?? 0,
      sparkline: [],
      icon: CheckCircle2,
      tone: "purple",
    },
    {
      id: "demos",
      label: "Demo Booked",
      value: data?.totals.demoBooked ?? 0,
      sparkline: data?.conversionsSeries ?? [],
      icon: CalendarCheck,
      tone: "blue",
    },
    {
      id: "conversions",
      label: "Conversions",
      value: data?.totals.conversions ?? 0,
      sparkline: [],
      icon: Target,
      tone: "red",
    },
  ];

  return (
    <>
      <PageTitle
        title="Analytics"
        subtitle="Get insights into your calling performance and lead conversions."
        actions={<ReportButton data={data} />}
      />

      {data?.source === "seed" && (
        <p className="mb-4 rounded-btn bg-warning-amber/[0.1] px-4 py-2.5 text-[13px] font-medium text-[#B4761A]">
          Showing sample data — the API is not reachable.
        </p>
      )}

      {failed && (
        <Card className="mb-4 px-4 py-3 text-[13px] text-slate-500">
          Could not load the analytics.
          <button
            type="button"
            onClick={load}
            className="ml-2 font-semibold text-accent-blue hover:underline"
          >
            Try again
          </button>
        </Card>
      )}

      <StatStrip stats={stats} />

      <div className="mt-5">
        <AnalyticsView data={data} loading={!data && !failed} />
      </div>
    </>
  );
}

/** Downloads what is on screen as one CSV — the totals, then each ranked table. */
function ReportButton({ data }: { data: AnalyticsData | null }) {
  const [building, setBuilding] = useState(false);

  function download() {
    if (!data) return;
    setBuilding(true);
    try {
      const rows: {
        section: string;
        label: string;
        value: number;
        interested: number | "";
        converted: number | "";
      }[] = [
        { section: "Totals", label: "Total calls", value: data.totals.totalCalls, interested: "", converted: "" },
        { section: "Totals", label: "Leads generated", value: data.totals.leadsGenerated, interested: "", converted: "" },
        { section: "Totals", label: "Interested leads", value: data.totals.interestedLeads, interested: "", converted: "" },
        { section: "Totals", label: "Demos booked", value: data.totals.demoBooked, interested: "", converted: "" },
        { section: "Totals", label: "Conversions", value: data.totals.conversions, interested: "", converted: "" },
        ...data.funnel.map((stage) => ({
          section: "Funnel",
          label: stage.label,
          value: stage.value,
          interested: "" as const,
          converted: "" as const,
        })),
        ...data.campaigns.map((row) => ({
          section: "Campaign",
          label: row.label,
          value: row.value,
          interested: row.interested,
          converted: row.conversions,
        })),
        ...data.cities.map((row) => ({
          section: "City",
          label: row.label,
          value: row.value,
          interested: row.interested,
          converted: row.conversions,
        })),
        ...data.agents.map((agent) => ({
          section: "AI agent",
          label: agent.name,
          value: agent.totalCalls,
          interested: agent.interested,
          converted: "" as const,
        })),
        ...data.hours
          .filter((entry) => entry.calls > 0)
          .map((entry) => ({
            section: `Calls by hour (${data.hoursTimezone})`,
            label: entry.hour,
            value: entry.calls,
            interested: "" as const,
            converted: "" as const,
          })),
      ];

      downloadCsv(
        `analytics-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(rows, [
          { header: "Section", value: (row) => row.section },
          { header: "Label", value: (row) => row.label },
          { header: "Value", value: (row) => row.value },
          { header: "Interested", value: (row) => row.interested },
          { header: "Converted", value: (row) => row.converted },
        ]),
      );
    } finally {
      setBuilding(false);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={!data || building}
      title={data ? undefined : "Waiting for the figures to load."}
      className="inline-flex h-11 items-center gap-2 rounded-btn border border-slate-200 bg-surface px-5 text-[14.5px] font-semibold text-accent-blue transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {building ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
      ) : (
        <Download className="h-4 w-4" strokeWidth={2.2} />
      )}
      Download Report
    </button>
  );
}
