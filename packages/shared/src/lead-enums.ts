/**
 * The lead enumerations, stated once.
 *
 * These used to be hand-written twice — once as the Prisma enum in apps/api and once as
 * a union in apps/web/lib/types.ts — with nothing checking that the two agreed. They
 * drifted the moment the schema gained NEGOTIATION, INVALID and LOST: the API happily
 * returned a status the web app had never heard of, and the status badge crashed on
 * `LEAD_STATUS[status]` being undefined. It failed at render time, in the browser, on
 * real data, which is the worst place to find out.
 *
 * Now the list lives here, apps/web derives its union from it, and apps/api has a
 * compile-time bridge (src/leads/lead-enum-sync.ts) that fails the build if the Prisma
 * enum and this list disagree. Adding a status is a one-line change that either compiles
 * everywhere or nowhere.
 */

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "FOLLOW_UP",
  "DEMO_BOOKED",
  "NEGOTIATION",
  "CONVERTED",
  "NOT_INTERESTED",
  "NO_ANSWER",
  "WRONG_NUMBER",
  "INVALID",
  "LOST",
  "CLOSED",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = [
  "UPLOAD",
  "AI_FOUND",
  "WEBSITE",
  "REFERRAL",
  "SOCIAL_MEDIA",
  "IMPORT",
  "API",
  "MANUAL",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_TEMPERATURES = ["HOT", "WARM", "COLD"] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

/**
 * Statuses that mean the lead is finished with, either way. Used to keep them out of
 * active work queues without every caller re-listing them and getting it subtly wrong.
 */
export const TERMINAL_LEAD_STATUSES: readonly LeadStatus[] = [
  "CONVERTED",
  "NOT_INTERESTED",
  "INVALID",
  "LOST",
  "CLOSED",
];

export function isTerminalLeadStatus(status: LeadStatus): boolean {
  return TERMINAL_LEAD_STATUSES.includes(status);
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function isLeadSource(value: unknown): value is LeadSource {
  return typeof value === "string" && (LEAD_SOURCES as readonly string[]).includes(value);
}
