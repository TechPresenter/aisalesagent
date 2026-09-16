import type { Tone } from "./status";

/** Feature List §11 — Analytics. Aggregates for May 1–31, 2025. */

export const analyticsTotals = {
  totalCalls: 342,
  leadsGenerated: 254,
  interestedLeads: 46,
  demoBooked: 22,
  conversions: 12,
};

/** Agent Performance — grouped bars, total calls against the interested subset. */
export interface AgentPerformance {
  name: string;
  language: string;
  totalCalls: number;
  interested: number;
}

export const agentPerformance: AgentPerformance[] = [
  { name: "Anjali", language: "Hindi", totalCalls: 98, interested: 28 },
  { name: "Rohan", language: "Hindi", totalCalls: 76, interested: 18 },
  { name: "Priya", language: "Hindi", totalCalls: 62, interested: 12 },
  { name: "Amit", language: "Hindi", totalCalls: 54, interested: 9 },
  { name: "Neha", language: "Hindi", totalCalls: 52, interested: 8 },
];

/**
 * A ranked row with a bar. `calls` doubles as the bar's value and the bar is scaled
 * against the largest row rather than a fixed maximum, so the top row always fills its
 * track and the comparison stays legible whatever the absolute numbers are.
 */
export interface RankedRow {
  label: string;
  /** Sub-label under the name; unused on the city table. */
  value: number;
  interested: number;
  interestedPercent: number;
  conversions: number;
  conversionPercent: number;
}

export const topCampaigns: RankedRow[] = [
  { label: "Dental Clinics - Bihar", value: 98, interested: 18, interestedPercent: 18, conversions: 6, conversionPercent: 6 },
  { label: "City Care Campaign", value: 76, interested: 12, interestedPercent: 16, conversions: 3, conversionPercent: 4 },
  { label: "Health & Wellness", value: 62, interested: 8, interestedPercent: 13, conversions: 2, conversionPercent: 3 },
  { label: "Multi Speciality - Delhi", value: 54, interested: 6, interestedPercent: 11, conversions: 2, conversionPercent: 4 },
  { label: "Orthopedic Clinics", value: 52, interested: 4, interestedPercent: 8, conversions: 1, conversionPercent: 2 },
];

export const leadsByCity: RankedRow[] = [
  { label: "Patna", value: 158, interested: 28, interestedPercent: 18, conversions: 6, conversionPercent: 6 },
  { label: "Gaya", value: 96, interested: 12, interestedPercent: 13, conversions: 3, conversionPercent: 3 },
  { label: "Ranchi", value: 72, interested: 10, interestedPercent: 14, conversions: 2, conversionPercent: 3 },
  { label: "Delhi", value: 68, interested: 8, interestedPercent: 12, conversions: 2, conversionPercent: 3 },
  { label: "Noida", value: 64, interested: 6, interestedPercent: 9, conversions: 1, conversionPercent: 2 },
];

/**
 * Call Time Distribution — calls placed per hour, 6 AM to 10 PM.
 *
 * The shape matters more than the individual bars: it is what the "best calling time"
 * insight is read off, so the two must agree. The peak here sits at 11 AM–2 PM, which is
 * what `keyInsights` claims below.
 */
export const callTimeDistribution = [
  { hour: "6 AM", calls: 6 },
  { hour: "7 AM", calls: 11 },
  { hour: "8 AM", calls: 19 },
  { hour: "9 AM", calls: 28 },
  { hour: "10 AM", calls: 34 },
  { hour: "11 AM", calls: 47 },
  { hour: "12 PM", calls: 51 },
  { hour: "1 PM", calls: 44 },
  { hour: "2 PM", calls: 56 },
  { hour: "3 PM", calls: 39 },
  { hour: "4 PM", calls: 48 },
  { hour: "5 PM", calls: 63 },
  { hour: "6 PM", calls: 45 },
  { hour: "7 PM", calls: 31 },
  { hour: "8 PM", calls: 34 },
  { hour: "9 PM", calls: 22 },
  { hour: "10 PM", calls: 9 },
];

/** Working Flow §Flow 6 — the pipeline, narrowing at each stage. */
export interface FunnelStage {
  label: string;
  value: number;
  tone: Tone;
}

export const leadFunnel: FunnelStage[] = [
  { label: "Total Leads", value: 254, tone: "blue" },
  { label: "Contacted", value: 128, tone: "green" },
  { label: "Interested", value: 46, tone: "green" },
  { label: "Demo Booked", value: 22, tone: "amber" },
  { label: "Converted", value: 12, tone: "red" },
];

/**
 * Key Insights. Each one is derived from a figure elsewhere on this page — the 18% is the
 * Total Calls trend, the 5% is 12/254 from the funnel — so the panel cannot drift out of
 * agreement with the charts above it.
 */
export interface Insight {
  id: string;
  icon: "trend" | "users" | "calendar" | "target" | "clock";
  text: string;
  tone: Tone;
}

export const keyInsights: Insight[] = [
  { id: "calls", icon: "trend", tone: "green", text: "Calls increased by 18% compared to last month. Great progress!" },
  { id: "leads", icon: "users", tone: "purple", text: "Lead generation is up by 33%. AI is performing well." },
  { id: "demos", icon: "calendar", tone: "blue", text: "22 demos booked this month (↑ 46%)." },
  {
    id: "conversion",
    icon: "target",
    tone: "amber",
    text: `Conversion rate is ${Math.round(
      (analyticsTotals.conversions / analyticsTotals.leadsGenerated) * 100,
    )}% (${analyticsTotals.conversions}/${analyticsTotals.leadsGenerated}). Keep nurturing follow-ups!`,
  },
  { id: "timing", icon: "clock", tone: "blue", text: "Best calling time: 11 AM – 2 PM (highest response rate)." },
];
