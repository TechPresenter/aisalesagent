import {
  callsApi,
  campaignsApi,
  isApiReachable,
  leadsApi,
  shortLanguageName,
  transcriptsApi,
  type ApiCallDetailed,
  type ApiTranscript,
  type CallStatus as ApiCallStatus,
} from "./api-client";
import {
  callOutcomes,
  callsTrend,
  kpiStats,
  latestSalesNote,
  leadSources,
  liveCalls as seedLiveCalls,
  recentLeads as seedRecentLeads,
} from "./mock-data";
import { CALL_OUTCOME, LEAD_SOURCE } from "./status";
import { formatDateTime } from "./utils";
import type {
  CallOutcome,
  KpiStat,
  Lead,
  LeadSource,
  LiveCall,
  SalesNote,
  TranscriptTurn,
} from "./types";

/**
 * Everything the dashboard shows. Read from the API; when the API is not reachable, the
 * seed set the screen was designed against stands in, flagged so the page says so rather
 * than presenting sample numbers as the workspace's own.
 */
export interface DashboardData {
  source: "api" | "seed";
  kpis: KpiStat[];
  outcomes: { outcome: CallOutcome; value: number }[];
  sources: { source: LeadSource; value: number }[];
  trend: { date: string; total: number; interested: number }[];
  /** What the trend's second line counts. The API's daily series has connected calls. */
  trendSecondLabel: string;
  recentLeads: Lead[];
  latestNote: SalesNote | null;
}

const SEED: DashboardData = {
  source: "seed",
  kpis: kpiStats,
  outcomes: callOutcomes,
  sources: leadSources,
  trend: callsTrend,
  trendSecondLabel: "Interested",
  recentLeads: seedRecentLeads,
  latestNote: latestSalesNote,
};

export async function loadDashboard(): Promise<DashboardData> {
  if (!(await isApiReachable())) return SEED;

  // Two small waves rather than one burst of eight: the dev database serves one query at a
  // time and drops connections when many arrive together. Each panel degrades on its own,
  // so a role without calling access still gets its leads.
  const [callStats, outcomes, overview, transcript] = await Promise.all([
    callsApi.historyStats().catch(() => null),
    callsApi.outcomes().catch(() => []),
    campaignsApi.overview().catch(() => null),
    transcriptsApi.list({ pageSize: 1 }).then(
      (page) => page.data[0] ?? null,
      () => null,
    ),
  ]);
  const [leadStats, aiFound, sources, recent] = await Promise.all([
    leadsApi.stats().catch(() => null),
    leadsApi.list({ source: ["AI_FOUND"], pageSize: 1 }).then(
      (page) => page.total,
      () => 0,
    ),
    leadsApi.sources().catch(() => []),
    leadsApi.list({ pageSize: 5 }).then(
      (page) => page.data,
      () => [],
    ),
  ]);

  const days = lastThirtyDays(overview?.series ?? []);

  return {
    source: "api",
    // No trend arrows: a trend needs a prior period, and the API does not compute one.
    kpis: [
      {
        id: "total-calls",
        label: "Total Calls",
        value: callStats?.total ?? 0,
        sparkline: days.map((day) => day.calls),
      },
      {
        id: "talked",
        label: "Talked",
        value: callStats?.connected ?? 0,
        sparkline: days.map((day) => day.connected),
      },
      { id: "interested", label: "Interested", value: callStats?.interested ?? 0, sparkline: [] },
      {
        id: "demo-booked",
        label: "Demo Booked",
        value: leadStats?.demoBooked ?? 0,
        sparkline: days.map((day) => day.conversions),
      },
      { id: "ai-leads", label: "Leads Found by AI", value: aiFound, sparkline: [] },
    ],
    outcomes: outcomes
      .filter((group) => group.count > 0 && group.outcome in CALL_OUTCOME)
      .map((group) => ({ outcome: group.outcome, value: group.count })),
    sources: sources
      .filter((group) => group.count > 0 && group.source in LEAD_SOURCE)
      .map((group) => ({ source: group.source, value: group.count })),
    trend: days.map((day) => ({ date: day.label, total: day.calls, interested: day.connected })),
    trendSecondLabel: "Connected",
    recentLeads: recent.map(
      (lead): Lead => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        city: lead.city ?? "—",
        source: lead.source,
        status: lead.status,
        score: lead.score,
        addedOn: lead.createdAt,
      }),
    ),
    latestNote: transcript ? await toSalesNote(transcript) : null,
  };
}

/** The latest transcribed call, as the AI Sales Notes card shows it. */
async function toSalesNote(transcript: ApiTranscript): Promise<SalesNote> {
  const lead = transcript.call?.lead ?? null;
  const [segments, record] = await Promise.all([
    transcriptsApi.segments(transcript.id).catch(() => []),
    lead ? leadsApi.get(lead.id).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    callId: transcript.callId,
    leadId: lead?.id,
    leadName: lead?.name ?? transcript.call?.phone ?? "Unknown lead",
    timestamp: formatDateTime(transcript.call?.startedAt ?? transcript.createdAt),
    turns: segments.slice(0, 12).map(
      (segment): TranscriptTurn => ({
        speaker: segment.speaker === "LEAD" ? "CLIENT" : "AI",
        label: segment.speakerLabel,
        text: segment.text,
      }),
    ),
    summary: transcript.summary ?? "No summary was generated for this call.",
    leadScore: record?.score,
  };
}

/** One entry per day for the last 30 days, oldest first. Days without calls count zero. */
export function lastThirtyDays(
  series: { date: string; calls: number; connected: number; conversions: number }[],
) {
  const byDate = new Map(series.map((point) => [point.date, point] as const));
  return Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.now() - (29 - index) * 86_400_000);
    const point = byDate.get(day.toISOString().slice(0, 10));
    return {
      label: day.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      calls: point?.calls ?? 0,
      connected: point?.connected ?? 0,
      conversions: point?.conversions ?? 0,
    };
  });
}

// ── live calls ──────────────────────────────────────────────────────────────────────

const IN_FLIGHT: ApiCallStatus[] = [
  "QUEUED",
  "DIALING",
  "RINGING",
  "CONNECTED",
  "ON_HOLD",
  "TRANSFERRING",
];

/** Calls that have not finished yet. Polled by the dashboard's Live Calls section. */
export async function loadLiveCalls(): Promise<{ calls: LiveCall[]; source: "api" | "seed" }> {
  if (!(await isApiReachable())) return { calls: seedLiveCalls, source: "seed" };
  const page = await callsApi.list({ status: IN_FLIGHT, pageSize: 10 });
  return { calls: page.data.map(toLiveCall), source: "api" };
}

function toLiveCall(call: ApiCallDetailed): LiveCall {
  const since = call.answeredAt ?? call.startedAt;
  return {
    id: call.id,
    phone: call.phone,
    clinicName: call.lead?.name ?? "Unknown lead",
    city: call.lead?.city ?? "—",
    // Seconds since the call connected; the section ticks it on between polls.
    duration: since ? Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000)) : 0,
    status: call.status,
    persona: {
      id: call.aiAgent?.id ?? "unassigned",
      name: call.aiAgent?.name ?? "AI Agent",
      language: call.aiAgent ? shortLanguageName(call.aiAgent.language) : "—",
      avatarUrl: "",
    },
  };
}
