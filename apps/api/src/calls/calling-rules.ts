/**
 * The gates every outbound call must pass before a number is dialled.
 *
 * Written as pure functions over plain data, deliberately. These are the rules that stop
 * the platform ringing someone at 3am, calling a number on the do-not-call list, or
 * dialling a lead for the ninth time — the kind of mistake that is a compliance
 * incident rather than a bug report. Keeping them free of Prisma, clocks and network
 * calls means they can be tested exhaustively and cheaply, and the tests are the actual
 * evidence that the gates work.
 *
 * The dialer calls `evaluateCallGates` and dials only on `allowed: true`. There is no
 * second path to placing a call.
 */

export type BlockReason =
  | "CAMPAIGN_NOT_ACTIVE"
  | "OUTSIDE_CALLING_WINDOW"
  | "DAY_NOT_ALLOWED"
  | "DO_NOT_CALL"
  | "NUMBER_BLOCKED"
  | "COUNTRY_NOT_ALLOWED"
  | "MAX_ATTEMPTS_REACHED"
  | "RETRY_TOO_SOON"
  | "DAILY_LIMIT_REACHED"
  | "INSUFFICIENT_CREDITS"
  | "CALLING_DISABLED"
  | "LEAD_ALREADY_CLOSED"
  | "INVALID_PHONE";

export interface GateDecision {
  allowed: boolean;
  /** Every reason it failed, not just the first — so a UI can explain the whole problem. */
  reasons: BlockReason[];
}

export interface CallingWindow {
  /** Minutes from midnight in the campaign's timezone. */
  startMinute: number;
  endMinute: number;
  /** Days of week the campaign may dial, 0 = Sunday. Empty means every day. */
  days: number[];
}

export interface GateInput {
  campaignStatus: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
  callingEnabled: boolean;
  window: CallingWindow;
  /** The local time to judge against, already converted to the campaign's timezone. */
  localNow: { minuteOfDay: number; dayOfWeek: number };

  lead: {
    phone: string;
    doNotCall: boolean;
    country: string | null;
    status: string;
  };

  attempts: number;
  maxAttempts: number;
  lastAttemptAt: Date | null;
  retryDelayMinutes: number;
  now: Date;

  callsToday: number;
  dailyCallLimit: number | null;

  creditBalance: number;
  creditCost: number;

  blockedNumbers: string[];
  /** Empty means no restriction. Otherwise the lead's country must appear. */
  allowedCountries: string[];
  dncEnabled: boolean;
}

/**
 * Lead statuses that mean the conversation is over.
 *
 * Calling a converted customer or someone who asked not to be contacted again is worse
 * than a wasted call — it is the thing that gets a number reported.
 */
const CLOSED_LEAD_STATUSES = new Set([
  "CONVERTED",
  "NOT_INTERESTED",
  "INVALID",
  "LOST",
  "CLOSED",
  "WRONG_NUMBER",
]);

/** Digits only, with an optional leading +. Anything else cannot be dialled. */
const E164_ISH = /^\+?[1-9]\d{7,14}$/;

export function evaluateCallGates(input: GateInput): GateDecision {
  const reasons: BlockReason[] = [];

  if (!input.callingEnabled) reasons.push("CALLING_DISABLED");
  if (input.campaignStatus !== "ACTIVE") reasons.push("CAMPAIGN_NOT_ACTIVE");

  // ── who we are calling ──────────────────────────────────────────────────────────
  if (!E164_ISH.test(input.lead.phone.replace(/[\s()-]/g, ""))) {
    reasons.push("INVALID_PHONE");
  }
  if (input.dncEnabled && input.lead.doNotCall) {
    reasons.push("DO_NOT_CALL");
  }
  if (CLOSED_LEAD_STATUSES.has(input.lead.status)) {
    reasons.push("LEAD_ALREADY_CLOSED");
  }
  if (isBlocked(input.lead.phone, input.blockedNumbers)) {
    reasons.push("NUMBER_BLOCKED");
  }
  if (
    input.allowedCountries.length > 0 &&
    (!input.lead.country || !input.allowedCountries.includes(input.lead.country))
  ) {
    reasons.push("COUNTRY_NOT_ALLOWED");
  }

  // ── when we are calling ─────────────────────────────────────────────────────────
  const { startMinute, endMinute, days } = input.window;
  const { minuteOfDay, dayOfWeek } = input.localNow;

  // Inclusive start, exclusive end: a window of 10:00–19:00 must not place a call *at*
  // 19:00, which would be one minute outside the hours the workspace agreed to.
  if (minuteOfDay < startMinute || minuteOfDay >= endMinute) {
    reasons.push("OUTSIDE_CALLING_WINDOW");
  }
  if (days.length > 0 && !days.includes(dayOfWeek)) {
    reasons.push("DAY_NOT_ALLOWED");
  }

  // ── how often ───────────────────────────────────────────────────────────────────
  if (input.attempts >= input.maxAttempts) {
    reasons.push("MAX_ATTEMPTS_REACHED");
  }
  if (input.lastAttemptAt) {
    const elapsedMinutes = (input.now.getTime() - input.lastAttemptAt.getTime()) / 60_000;
    if (elapsedMinutes < input.retryDelayMinutes) {
      reasons.push("RETRY_TOO_SOON");
    }
  }
  if (input.dailyCallLimit !== null && input.callsToday >= input.dailyCallLimit) {
    reasons.push("DAILY_LIMIT_REACHED");
  }

  // ── whether we can pay for it ───────────────────────────────────────────────────
  if (input.creditBalance < input.creditCost) {
    reasons.push("INSUFFICIENT_CREDITS");
  }

  return { allowed: reasons.length === 0, reasons };
}

/**
 * Matches on digits, so a blocked number entered as "+91 98765 43210" still blocks a
 * lead stored as "919876543210". Comparing the strings as typed would let formatting
 * defeat the block list, which is the one thing it must not do.
 */
export function isBlocked(phone: string, blockedNumbers: string[]): boolean {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return false;
  return blockedNumbers.some((blocked) => {
    const blockedDigits = blocked.replace(/\D/g, "");
    if (!blockedDigits) return false;
    // Suffix match: a workspace blocking "9876543210" means that subscriber, whether or
    // not the stored row carries a country code.
    return digits.endsWith(blockedDigits) || blockedDigits.endsWith(digits);
  });
}

/**
 * The wall-clock time in an IANA timezone, as the pieces the window check needs.
 *
 * Uses Intl rather than arithmetic on UTC offsets because offsets are not constant —
 * a campaign in a DST-observing zone would drift by an hour twice a year, and the calls
 * would start landing before the hours the workspace configured.
 */
export function localTimeIn(timezone: string, at: Date = new Date()): {
  minuteOfDay: number;
  dayOfWeek: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = formatter.formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";

  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    // Intl renders midnight as hour 24 in some locales under hour12:false; normalise so
    // "00:30" is minute 30 rather than minute 1470, which would look like late evening.
    minuteOfDay: (hour % 24) * 60 + minute,
    dayOfWeek: days[weekday] ?? 0,
  };
}

/** Human-readable, for the UI and the call's `failureReason`. */
export const BLOCK_REASON_TEXT: Record<BlockReason, string> = {
  CAMPAIGN_NOT_ACTIVE: "The campaign is not active.",
  OUTSIDE_CALLING_WINDOW: "Outside the campaign's calling hours.",
  DAY_NOT_ALLOWED: "The campaign does not call on this day.",
  DO_NOT_CALL: "This lead is on the do-not-call list.",
  NUMBER_BLOCKED: "This number is on the workspace's blocked list.",
  COUNTRY_NOT_ALLOWED: "Calling this country is not enabled for this workspace.",
  MAX_ATTEMPTS_REACHED: "The maximum number of attempts has been reached.",
  RETRY_TOO_SOON: "The retry delay since the last attempt has not elapsed.",
  DAILY_LIMIT_REACHED: "The campaign has reached its daily call limit.",
  INSUFFICIENT_CREDITS: "There are not enough credits to place this call.",
  CALLING_DISABLED: "AI calling is switched off for this workspace.",
  LEAD_ALREADY_CLOSED: "This lead is closed and should not be called again.",
  INVALID_PHONE: "The stored phone number is not dialable.",
};
