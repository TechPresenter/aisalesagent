/**
 * The call enumerations, stated once — same arrangement as `lead-enums.ts`, and for the
 * same reason: apps/web previously kept a hand-written copy that drifted from the Prisma
 * enum. It had `TALKING` where the database has `CONNECTED`, so a live call rendered a
 * badge for a status the UI had never heard of.
 *
 * apps/api has a compile-time bridge (`src/calls/call-enum-sync.ts`) that fails the build
 * if this list and the Prisma enum disagree.
 */

export const CALL_STATUSES = [
  "QUEUED",
  "DIALING",
  "RINGING",
  "CONNECTED",
  "ON_HOLD",
  "TRANSFERRING",
  "COMPLETED",
  "FAILED",
  "BUSY",
  "NO_ANSWER",
  "VOICEMAIL",
  "CANCELLED",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_OUTCOMES = [
  "INTERESTED",
  "FOLLOW_UP",
  "NOT_INTERESTED",
  "NO_ANSWER",
  "WRONG_NUMBER",
  "DEMO_BOOKED",
  "CALLBACK_REQUESTED",
  "DO_NOT_CALL",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Statuses that mean the call is over. Anything else is still in flight. */
export const TERMINAL_CALL_STATUSES: readonly CallStatus[] = [
  "COMPLETED",
  "FAILED",
  "BUSY",
  "NO_ANSWER",
  "VOICEMAIL",
  "CANCELLED",
];

export function isCallInFlight(status: CallStatus): boolean {
  return !TERMINAL_CALL_STATUSES.includes(status);
}
