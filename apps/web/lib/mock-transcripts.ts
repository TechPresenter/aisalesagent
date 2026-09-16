import { calls, type CallRecord } from "./mock-calls";
import type { Tone } from "./status";
import type { TranscriptTurn } from "./types";
import { formatDuration } from "./utils";

/**
 * Feature List §7 — Transcripts.
 *
 * Derived from `calls` rather than seeded again. A transcript is not a separate record,
 * it is what a call produced, so the clinic, phone, agent and duration have exactly one
 * source — the same reason Call History, Recordings and AI Calling share `mock-calls`.
 * Only the transcript-specific parts are added here: per-turn timing, the outcome the
 * agent recorded, and the AI summary.
 */

/** A transcript turn with its offset into the recording, in seconds. */
export interface TranscriptLine extends TranscriptTurn {
  at: number;
}

export interface TranscriptSummary {
  headline: string;
  points: string[];
  nextStep: string;
  sentiment: "Positive" | "Neutral" | "Negative";
  leadScore: number;
}

export interface TranscriptRecord {
  id: string;
  call: CallRecord;
  /**
   * What the call produced. `CallRecord["status"]` already carries the outcome for rows
   * that ended in one, so the badge reads from the same `CALL_LOG_STATUS` table the Call
   * History status column does and the two screens cannot disagree.
   */
  outcome: CallRecord["status"];
  lines: TranscriptLine[];
  summary: TranscriptSummary;
}

/**
 * Turn offsets for the reference transcript, measured against the 84-second reference
 * call and scaled to each row's own duration. Fixed rather than generated: a transcript
 * whose timings reshuffle between renders reads as a bug even when nothing is wrong.
 */
const TURN_AT = [0, 8, 12, 28, 45, 70];
const REFERENCE_DURATION = 84;

/**
 * A call that merely CONNECTED has no outcome of its own yet — the agent's disposition
 * supplies one. Every other status already *is* the outcome and passes through, so no
 * row can show "Missed" on Call History and something friendlier here.
 */
const DISPOSITION: Record<string, CallRecord["status"]> = {
  "call-1": "INTERESTED",
  "call-2": "FOLLOW_UP",
  "call-5": "INTERESTED",
  "call-9": "FOLLOW_UP",
};

const SUMMARIES: Record<string, TranscriptSummary> = {
  INTERESTED: {
    headline:
      "The clinic runs appointments and billing on paper and asked to see the product. Positive throughout.",
    points: [
      "Currently managing patients in a paper register — no software in place.",
      "Asked directly about pricing and how billing is handled.",
      "Agreed to a demo and proposed 11:00 AM the next day.",
    ],
    nextStep: "Send the pricing sheet, then confirm the 11:00 AM demo slot.",
    sentiment: "Positive",
    leadScore: 86,
  },
  FOLLOW_UP: {
    headline:
      "Reached the front desk rather than the decision maker. Interest is real but unconfirmed.",
    points: [
      "The person who answered does not decide on software purchases.",
      "Asked what the onboarding timeline looks like.",
      "A callback window was agreed rather than a demo.",
    ],
    nextStep: "Call back inside the agreed window and ask for the owner by name.",
    sentiment: "Neutral",
    leadScore: 62,
  },
  NOT_INTERESTED: {
    headline: "Already on a competing system and under contract, so there is no opening now.",
    points: [
      "Using another practice-management vendor.",
      "Contract runs to next year.",
      "No objection to the product itself — the timing is the blocker.",
    ],
    nextStep: "Park the lead and re-approach a quarter before their contract ends.",
    sentiment: "Negative",
    leadScore: 24,
  },
  NO_ANSWER: {
    headline: "Nobody picked up, so there is no conversation to summarise.",
    points: ["The line rang out with no answer.", "Requeued for retry under the campaign rules."],
    nextStep: "Retry mid-morning, when clinics are typically staffed.",
    sentiment: "Neutral",
    leadScore: 40,
  },
  MISSED: {
    headline: "The call never reached the carrier, so nothing was recorded.",
    points: ["The dial failed before the line rang.", "Worth checking the number is still in service."],
    nextStep: "Verify the number, then requeue.",
    sentiment: "Neutral",
    leadScore: 35,
  },
  BUSY: {
    headline: "The line was engaged and the call did not connect.",
    points: ["Busy signal on the first attempt.", "Requeued automatically."],
    nextStep: "Retry later the same day.",
    sentiment: "Neutral",
    leadScore: 45,
  },
};

export const SENTIMENT_TONE: Record<TranscriptSummary["sentiment"], Tone> = {
  Positive: "green",
  Neutral: "gray",
  Negative: "red",
};

export const transcripts: TranscriptRecord[] = calls.map((call) => {
  const outcome = call.status === "CONNECTED" ? DISPOSITION[call.id] ?? "FOLLOW_UP" : call.status;
  const scale = call.duration / REFERENCE_DURATION;

  return {
    id: `transcript-${call.id}`,
    call,
    outcome,
    // A call with no duration produced no audio and therefore no transcript.
    lines:
      call.duration > 0
        ? call.transcript.map((turn, index) => ({
            ...turn,
            at: Math.round((TURN_AT[index] ?? index * 12) * scale),
          }))
        : [],
    summary: SUMMARIES[outcome] ?? SUMMARIES.FOLLOW_UP,
  };
});

/** KPI strip — workspace totals for the period, not counts of the rows above. */
export const transcriptTotals = {
  total: 342,
  positive: 128,
  interested: 46,
  notInterested: 22,
};

export const transcriptCampaigns = Array.from(new Set(calls.map((call) => call.campaign)));

/** Plain-text rendering, for the Copy Transcript button and the download. */
export function transcriptAsText(record: TranscriptRecord) {
  const header = `${record.call.clinicName} — ${record.call.phone}`;
  const body = record.lines.map(
    (line) =>
      `[${formatDuration(line.at)}] ${line.speaker === "AI" ? `${record.call.agent.name} (AI)` : "Client"}: ${line.text}`,
  );
  return [header, "", ...body].join("\n");
}
