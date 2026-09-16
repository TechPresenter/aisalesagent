import type { CallOutcome, CallStatus, LeadPriority, LeadSource, LeadStatus } from "./types";

/**
 * Brand Guidelines §5 (Status badges): "Color mapping is fixed and never reused for a
 * different meaning: green = positive/interested, blue = informational/follow-up,
 * red = negative, gray = inactive/no answer, amber = needs attention/wrong number,
 * purple = AI-related."
 *
 * Every badge, donut slice and chart series reads its colour from this one table, which
 * is what keeps a colour meaning the same thing everywhere on the page.
 */
export type Tone = "green" | "blue" | "red" | "gray" | "amber" | "purple";

export const TONE_HEX: Record<Tone, string> = {
  green: "#19B969",
  blue: "#237DF5",
  red: "#F55F5F",
  gray: "#919BA5",
  amber: "#F5A623",
  purple: "#7D55CD",
};

/** Pill styling: 12–15% tint background with the solid colour as text. */
export const TONE_BADGE: Record<Tone, string> = {
  green: "bg-brand-green/[0.13] text-deep-green",
  blue: "bg-accent-blue/[0.13] text-accent-blue",
  red: "bg-alert-red/[0.14] text-[#C93B3B]",
  gray: "bg-neutral-gray/[0.16] text-[#5E6873]",
  amber: "bg-warning-amber/[0.15] text-[#B4761A]",
  purple: "bg-accent-purple/[0.13] text-accent-purple",
};

export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  // Blue rather than gray: a new lead is not inactive, it is in the pipeline and
  // untouched. Blue is the "informational, no signal either way" tone, which is exactly
  // what New and Follow-up have in common.
  NEW: { label: "New", tone: "blue" },
  CONTACTED: { label: "Contacted", tone: "blue" },
  INTERESTED: { label: "Interested", tone: "green" },
  FOLLOW_UP: { label: "Follow-up", tone: "blue" },
  NOT_INTERESTED: { label: "Not Interested", tone: "red" },
  NO_ANSWER: { label: "No Answer", tone: "gray" },
  WRONG_NUMBER: { label: "Wrong Number", tone: "amber" },
  DEMO_BOOKED: { label: "Demo Booked", tone: "purple" },
  // Amber, not green: a negotiation is the point where the deal most needs attention,
  // and colouring it as a win would flatter the pipeline.
  NEGOTIATION: { label: "Negotiation", tone: "amber" },
  CONVERTED: { label: "Converted", tone: "green" },
  // Invalid is a data problem rather than a sales outcome — amber, because someone has
  // to go and fix the record, unlike Lost which is simply over.
  INVALID: { label: "Invalid", tone: "amber" },
  LOST: { label: "Lost", tone: "red" },
  CLOSED: { label: "Closed", tone: "gray" },
};

export const CALL_STATUS: Record<CallStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: "Queued", tone: "gray" },
  DIALING: { label: "Dialing", tone: "gray" },
  RINGING: { label: "Ringing", tone: "blue" },
  CONNECTED: { label: "Connected", tone: "green" },
  ON_HOLD: { label: "On Hold", tone: "amber" },
  TRANSFERRING: { label: "Transferring", tone: "blue" },
  COMPLETED: { label: "Completed", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  BUSY: { label: "Busy", tone: "amber" },
  NO_ANSWER: { label: "No Answer", tone: "gray" },
  VOICEMAIL: { label: "Voicemail", tone: "amber" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};

export const CALL_OUTCOME: Record<CallOutcome, { label: string; tone: Tone }> = {
  INTERESTED: { label: "Interested", tone: "green" },
  FOLLOW_UP: { label: "Follow-up", tone: "blue" },
  NOT_INTERESTED: { label: "Not Interested", tone: "red" },
  NO_ANSWER: { label: "No Answer", tone: "gray" },
  WRONG_NUMBER: { label: "Wrong Number", tone: "amber" },
  // Purple is the AI tone, and a booked demo is what the AI agent exists to produce.
  DEMO_BOOKED: { label: "Demo Booked", tone: "purple" },
  CALLBACK_REQUESTED: { label: "Callback Requested", tone: "blue" },
  // Red, and deliberately not gray: this is a compliance instruction, not an absence.
  DO_NOT_CALL: { label: "Do Not Call", tone: "red" },
};

/**
 * Brand Guidelines §3 assigns Accent Purple to "AI-generated content, 'AI Found',
 * special features" — so the AI-sourced side of the split is the purple one, and the
 * human-uploaded side takes informational blue.
 */
export const LEAD_SOURCE: Record<LeadSource, { label: string; tone: Tone }> = {
  UPLOAD: { label: "Your Upload", tone: "blue" },
  AI_FOUND: { label: "AI Found", tone: "purple" },
  // Channels the tenant owns and drives share the informational blue; third-party and
  // passive arrivals are neutral. Neither is a quality judgement — that is the score's job.
  WEBSITE: { label: "Website", tone: "blue" },
  REFERRAL: { label: "Referral", tone: "gray" },
  SOCIAL_MEDIA: { label: "Social Media", tone: "gray" },
  // Bulk arrivals and machine-created rows. Neutral because how a lead got here is not a
  // quality signal — the score says that.
  IMPORT: { label: "Import", tone: "blue" },
  API: { label: "API", tone: "gray" },
  MANUAL: { label: "Manual", tone: "gray" },
};

/**
 * Feature List §2 — the 0-100 AI lead score, banded for the table pill and the score
 * block on the detail page. The bands are here rather than in a component for the same
 * reason every other colour is: so a 74 is the same colour in the table, the side panel
 * and the detail header, and changing where the line falls is one edit.
 */
export function scoreTone(score: number): Tone {
  if (score >= 75) return "green";
  if (score >= 50) return "amber";
  return "red";
}

/** Feature List §10 — follow-up priority. */
export const LEAD_PRIORITY: Record<LeadPriority, { label: string; tone: Tone }> = {
  HIGH: { label: "High", tone: "red" },
  MEDIUM: { label: "Medium", tone: "amber" },
  LOW: { label: "Low", tone: "gray" },
};
