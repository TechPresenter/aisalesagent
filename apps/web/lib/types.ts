/**
 * Domain types mirroring the TRD §7 data model. Field names match the spec exactly
 * so the API layer can be dropped in later without a rename pass.
 */

/** Working Flow §Flow 6 — Lead status state machine. */
/**
 * Re-exported from @appsgain/shared rather than written out again here. The previous
 * hand-copy drifted from the database enum and crashed the status badge on real data;
 * apps/api has a compile-time bridge (src/leads/lead-enum-sync.ts) keeping the shared
 * list and the Prisma enum in step, so importing it means this app cannot fall behind.
 */
export type { LeadStatus, LeadSource, LeadTemperature } from "@appsgain/shared";
export type { CallStatus, CallOutcome } from "@appsgain/shared";
export { LEAD_STATUSES, LEAD_SOURCES } from "@appsgain/shared";
import type { CallOutcome, CallStatus, LeadSource, LeadStatus } from "@appsgain/shared";

/** Working Flow §Flow 7 — Call status state machine. */

/** Feature List §1 — the five outcomes the Call Outcomes donut breaks down. */

/**
 * Where a lead came from. The semantic split the palette encodes: purple for the
 * AI-sourced one, blue for channels the tenant owns and drives, gray for third-party
 * and passive arrivals.
 */

/** Feature List §10 — follow-up urgency, shown on the lead detail header. */
export type LeadPriority = "HIGH" | "MEDIUM" | "LOW";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  city: string;
  source: LeadSource;
  status: LeadStatus;
  score: number;
  addedOn: string;
}

export interface AIAgentPersona {
  id: string;
  name: string;
  language: string;
  avatarUrl: string;
}

export interface LiveCall {
  id: string;
  phone: string;
  clinicName: string;
  city: string;
  /** Seconds elapsed. Ticks client-side between WebSocket pushes. */
  duration: number;
  status: CallStatus;
  persona: AIAgentPersona;
}

export interface TranscriptTurn {
  speaker: "AI" | "CLIENT";
  /** The speaker's own label ("Maya", "Lead") when known; otherwise AI / Client. */
  label?: string;
  text: string;
}

export interface SalesNote {
  callId: string;
  leadName: string;
  timestamp: string;
  turns: TranscriptTurn[];
  summary: string;
  /** Absent when the lead could not be read — the badge is left off rather than guessed. */
  leadScore?: number;
  leadId?: string;
}

export interface KpiStat {
  id: string;
  label: string;
  value: number;
  /** Percentage change vs the previous period; undefined when there is no trend. */
  trend?: number;
  sparkline: number[];
}

/* ------------------------------------------------------------------ *
 * Build Plan Phase 4 — Leads Management
 * ------------------------------------------------------------------ */

/**
 * A row in a lead's call history. Mirrors the Call entity (TRD §7) reduced to the
 * columns GET /calls?lead_id= is specified to return for the drill-down table.
 */
export interface LeadCall {
  id: string;
  /** ISO timestamp the call was placed. */
  startedAt: string;
  /** Seconds; 0 for calls that never connected. */
  duration: number;
  status: CallStatus;
  /** Absent while the call is still running or when it never connected. */
  outcome?: CallOutcome;
  personaName: string;
  campaignName: string;
  hasRecording: boolean;
  /** Present for calls that were transcribed, so the transcript can be opened in place. */
  transcriptId?: string;
  transcriptSummary?: string;
}

/** SalesNote §9 plus Feature List §9 "Manual note override" — hence the two authors. */
export interface LeadNote {
  id: string;
  author: "AI" | "HUMAN";
  authorName: string;
  timestamp: string;
  text: string;
}

/** Feature List §2 — "AI lead score with rationale": the contributing factors. */
export interface ScoreFactor {
  label: string;
  impact: "positive" | "negative";
}

/**
 * Everything the lead detail view renders. `Lead` stays the list row so the table and
 * GET /leads keep their narrow shape; the detail page is GET /leads/{id}.
 */
export interface LeadDetail extends Lead {
  /** The person who answers — shown under the clinic name everywhere a lead is listed. */
  contactPerson: string;
  email?: string;
  website?: string;
  /** Industry Template field — "Dental Clinic", "Diagnostic Lab", … (TRD §7 custom_fields). */
  category: string;
  address: string;
  tags: string[];
  /** Campaign the lead is currently worked under (TRD §7 Campaign). */
  campaign?: string;
  /** AI persona assigned to this lead — name and language, e.g. "Anjali (Hindi)". */
  assignedAgent?: AIAgentPersona;
  priority: LeadPriority;
  /** ISO timestamp of the most recent call attempt; absent for never-contacted leads. */
  lastContactedAt?: string;
  nextFollowUp?: FollowUp;
  /** Free-text summary the sales team maintains by hand, shown on the Overview tab. */
  freeformNotes?: string;
  scoreFactors: ScoreFactor[];
  calls: LeadCall[];
  notes: LeadNote[];
  activity: ActivityEvent[];
  /** Feature List §9 — the AI summary and its extracted key points. */
  aiSummary?: string;
  keyPoints: string[];
}

/** Feature List §10 — Follow-ups & Tasks. */
export interface FollowUp {
  /** The follow-up row's id; absent for seed data. */
  id?: string;
  /** ISO timestamp of when the follow-up is due. */
  dueAt: string;
  description: string;
}

/**
 * One entry in the lead's activity timeline. The `kind` drives the icon and tint, so a
 * new event type is one entry in ACTIVITY_STYLE rather than a branch in the component.
 */
export type ActivityKind =
  | "CALL"
  | "NOTE"
  | "FOLLOW_UP"
  | "TRANSCRIPT"
  | "EMAIL"
  | "STATUS_CHANGE";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  title: string;
  /** Second line under the title — a duration, a scheduled time, a recipient. */
  subtitle?: string;
  /** Body text, rendered in a tinted block. */
  detail?: string;
  timestamp: string;
}
