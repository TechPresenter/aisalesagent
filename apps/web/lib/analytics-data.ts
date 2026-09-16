import {
  agentsApi,
  callsApi,
  campaignsApi,
  followUpsApi,
  isApiReachable,
  leadsApi,
  shortLanguageName,
  type ApiCampaign,
  type CityBreakdown,
} from "./api-client";
import { lastThirtyDays } from "./dashboard-data";
import {
  agentPerformance as seedAgents,
  analyticsTotals as seedTotals,
  callTimeDistribution as seedHours,
  keyInsights as seedInsights,
  leadFunnel as seedFunnel,
  leadsByCity as seedCities,
  topCampaigns as seedCampaigns,
  type AgentPerformance,
  type FunnelStage,
  type Insight,
  type RankedRow,
} from "./mock-analytics";
import {
  callOutcomes as seedOutcomes,
  callsTrend as seedTrend,
  leadSources as seedSources,
} from "./mock-data";
import { CALL_OUTCOME, LEAD_SOURCE } from "./status";
import type { CallOutcome, LeadSource, LeadStatus } from "./types";

export type { AgentPerformance, FunnelStage, Insight, RankedRow } from "./mock-analytics";

/**
 * Everything the Analytics screen shows, counted in the database. When the API is not
 * reachable the seed set stands in, flagged, so the page says whose numbers these are.
 */
export interface AnalyticsData {
  source: "api" | "seed";
  totals: {
    totalCalls: number;
    leadsGenerated: number;
    interestedLeads: number;
    demoBooked: number;
    conversions: number;
  };
  trend: { date: string; total: number; interested: number }[];
  /** What the trend's second line counts — the API's daily series has connected calls. */
  trendSecondLabel: string;
  /** Sparkline series for the KPI strip, in the same order as `totals`. */
  callsSeries: number[];
  conversionsSeries: number[];
  sources: { source: LeadSource; value: number }[];
  outcomes: { outcome: CallOutcome; value: number }[];
  agents: AgentPerformance[];
  campaigns: RankedRow[];
  cities: RankedRow[];
  hours: { hour: string; calls: number; connected: number }[];
  /** The clock the hours are in, e.g. "Asia/Kolkata". */
  hoursTimezone: string;
  funnel: FunnelStage[];
  insights: Insight[];
}

const SEED: AnalyticsData = {
  source: "seed",
  totals: seedTotals,
  trend: seedTrend,
  trendSecondLabel: "Interested",
  callsSeries: seedTrend.map((point) => point.total),
  conversionsSeries: seedTrend.map((point) => point.interested),
  sources: seedSources,
  outcomes: seedOutcomes,
  agents: seedAgents,
  campaigns: seedCampaigns,
  cities: seedCities,
  hours: seedHours.map((entry) => ({ ...entry, connected: 0 })),
  hoursTimezone: "Asia/Kolkata",
  funnel: seedFunnel,
  insights: seedInsights,
};

/** Whole percent of a total, and 0 rather than NaN when there is nothing to divide by. */
function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

/** 9 -> "9 AM", 14 -> "2 PM". */
function hourLabel(hour: number): string {
  const clock = hour % 12 === 0 ? 12 : hour % 12;
  return `${clock} ${hour < 12 ? "AM" : "PM"}`;
}

export async function loadAnalytics(): Promise<AnalyticsData> {
  if (!(await isApiReachable())) return SEED;

  // Three small waves rather than one burst of eleven requests: the dev database serves
  // one query at a time and drops connections when many arrive together. Each panel
  // degrades on its own, so one refusal empties one card rather than the page.
  const [callStats, outcomes, overview] = await Promise.all([
    callsApi.historyStats().catch(() => null),
    callsApi.outcomes().catch(() => []),
    campaignsApi.overview().catch(() => null),
  ]);
  const [byHour, leadStats, statuses, sources] = await Promise.all([
    callsApi.byHour().catch(() => null),
    leadsApi.stats().catch(() => null),
    leadsApi.statuses().catch(() => []),
    leadsApi.sources().catch(() => []),
  ]);
  const [cities, agents, campaigns, followUps] = await Promise.all([
    leadsApi.cities().catch((): CityBreakdown[] => []),
    agentsApi.performance().catch(() => []),
    campaignsApi.list({ pageSize: 50 }).then(
      (page) => page.data,
      (): ApiCampaign[] => [],
    ),
    followUpsApi.stats().catch(() => null),
  ]);

  const days = lastThirtyDays(overview?.series ?? []);
  const statusCount = (status: LeadStatus) =>
    statuses.find((entry) => entry.status === status)?.count ?? 0;
  const totalLeads = statuses.reduce((sum, entry) => sum + entry.count, 0);

  const agentRows: AgentPerformance[] = agents.slice(0, 5).map((agent) => ({
    name: agent.name,
    language: shortLanguageName(agent.language),
    totalCalls: agent.calls,
    interested: agent.interested,
  }));

  const campaignRows: RankedRow[] = campaigns
    .map((campaign) => ({
      label: campaign.name,
      value: campaign.stats.calls,
      interested: campaign.stats.interested,
      interestedPercent: percent(campaign.stats.interested, campaign.stats.calls),
      conversions: campaign.stats.converted,
      conversionPercent: percent(campaign.stats.converted, campaign.stats.calls),
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const cityRows: RankedRow[] = cities.slice(0, 5).map((city) => ({
    label: city.city,
    value: city.leads,
    interested: city.interested,
    interestedPercent: percent(city.interested, city.leads),
    conversions: city.converted,
    conversionPercent: percent(city.converted, city.leads),
  }));

  // 6 AM to 10 PM, the working day the chart was designed around, with quiet hours at zero.
  const hourRows = Array.from({ length: 17 }, (_, index) => {
    const hour = index + 6;
    const row = byHour?.hours.find((entry) => entry.hour === hour);
    return { hour: hourLabel(hour), calls: row?.calls ?? 0, connected: row?.connected ?? 0 };
  });

  return {
    source: "api",
    totals: {
      totalCalls: callStats?.total ?? 0,
      leadsGenerated: leadStats?.total ?? 0,
      interestedLeads: leadStats?.interested ?? 0,
      demoBooked: leadStats?.demoBooked ?? 0,
      conversions: leadStats?.converted ?? 0,
    },
    trend: days.map((day) => ({ date: day.label, total: day.calls, interested: day.connected })),
    trendSecondLabel: "Connected",
    callsSeries: days.map((day) => day.calls),
    conversionsSeries: days.map((day) => day.conversions),
    sources: sources
      .filter((group) => group.count > 0 && group.source in LEAD_SOURCE)
      .map((group) => ({ source: group.source, value: group.count })),
    outcomes: outcomes
      .filter((group) => group.count > 0 && group.outcome in CALL_OUTCOME)
      .map((group) => ({ outcome: group.outcome, value: group.count })),
    agents: agentRows,
    campaigns: campaignRows,
    cities: cityRows,
    hours: hourRows,
    hoursTimezone: byHour?.timezone ?? "UTC",
    // "Contacted" is every lead that has moved past NEW — the funnel's second band is
    // about having reached them at all, not about how it went.
    funnel: [
      { label: "Total Leads", value: totalLeads, tone: "blue" },
      { label: "Contacted", value: totalLeads - statusCount("NEW"), tone: "green" },
      { label: "Interested", value: statusCount("INTERESTED"), tone: "green" },
      { label: "Demo Booked", value: statusCount("DEMO_BOOKED"), tone: "amber" },
      { label: "Converted", value: statusCount("CONVERTED"), tone: "red" },
    ],
    insights: buildInsights({
      hours: byHour?.hours ?? [],
      timezone: byHour?.timezone ?? "UTC",
      cities,
      agents,
      leads: { total: leadStats?.total ?? 0, converted: leadStats?.converted ?? 0 },
      dueFollowUps: followUps ? followUps.today + followUps.overdue : 0,
    }),
  };
}

/**
 * The insight list, read off the same figures as the charts rather than written for the
 * screenshot: every line names the numbers it came from, so a reader can check it.
 */
function buildInsights(input: {
  hours: { hour: number; calls: number; connected: number }[];
  timezone: string;
  cities: CityBreakdown[];
  agents: { name: string; calls: number; interested: number }[];
  leads: { total: number; converted: number };
  dueFollowUps: number;
}): Insight[] {
  const insights: Insight[] = [];

  const busiest = [...input.hours].sort((a, b) => b.calls - a.calls)[0];
  if (busiest && busiest.calls > 0) {
    insights.push({
      id: "timing",
      icon: "clock",
      tone: "blue",
      text: `Most calls go out around ${hourLabel(busiest.hour)} (${input.timezone}) — ${
        busiest.calls
      } calls, ${percent(busiest.connected, busiest.calls)}% connected.`,
    });
  }

  const bestAgent = [...input.agents]
    .filter((agent) => agent.calls > 0)
    .sort((a, b) => percent(b.interested, b.calls) - percent(a.interested, a.calls))[0];
  if (bestAgent) {
    insights.push({
      id: "agent",
      icon: "trend",
      tone: "green",
      text: `${bestAgent.name} gets the most interest: ${bestAgent.interested} of ${
        bestAgent.calls
      } calls (${percent(bestAgent.interested, bestAgent.calls)}%).`,
    });
  }

  const topCity = input.cities[0];
  if (topCity) {
    insights.push({
      id: "city",
      icon: "users",
      tone: "purple",
      text: `${topCity.city} holds the most leads (${topCity.leads}), ${topCity.interested} of them interested.`,
    });
  }

  if (input.leads.total > 0) {
    insights.push({
      id: "conversion",
      icon: "target",
      tone: "amber",
      text: `Conversion rate is ${percent(input.leads.converted, input.leads.total)}% (${
        input.leads.converted
      } of ${input.leads.total} leads).`,
    });
  }

  if (input.dueFollowUps > 0) {
    insights.push({
      id: "followups",
      icon: "calendar",
      tone: "red",
      text: `${input.dueFollowUps} follow-ups are due today or already overdue.`,
    });
  }

  return insights;
}
