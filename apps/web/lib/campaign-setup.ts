import type {
  ApiAgent,
  ApiCampaign,
  CampaignLeadState,
  CampaignSettingsInput,
} from "@/lib/api-client";
import type { Tone } from "@/lib/status";

/**
 * The rules behind the campaign page, kept out of the component so they can be tested:
 * the script an agent prefills, what activation will insist on, and the clock and
 * calendar conversions the schedule form needs.
 */

/** Monday first, the way a working week is read; Sunday is 0 in the stored array. */
export const WEEK_DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/** The longest call script the API accepts. */
export const MAX_CALL_SCRIPT_LENGTH = 20_000;

/** The most leads one "add all matching" request may add (MAX_LEADS_PER_ADD in the API). */
export const MAX_LEADS_PER_ADD = 10_000;

/** Campaign types that dial, and so take an AI agent and a script. */
export const CALLING_TYPES: ApiCampaign["type"][] = ["AI_CALLING", "MULTI_CHANNEL"];

/** Where the dialer is with one lead of a campaign. */
export const CAMPAIGN_LEAD_STATE: Record<CampaignLeadState, { label: string; tone: Tone }> = {
  PENDING: { label: "Waiting", tone: "blue" },
  QUEUED: { label: "Queued", tone: "blue" },
  IN_PROGRESS: { label: "On a call", tone: "purple" },
  COMPLETED: { label: "Done", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  // Amber: someone may want to know why a lead was passed over.
  SKIPPED: { label: "Skipped", tone: "amber" },
  EXHAUSTED: { label: "Out of attempts", tone: "gray" },
};

type AgentScript = Pick<
  ApiAgent,
  "openingMessage" | "qualificationQuestions" | "objectionHandling" | "closingInstructions"
>;

/**
 * An agent's script as the plain text a campaign stores: opening, questions, objection
 * answers, closing. `null` when the agent has none of them.
 *
 * The API writes exactly this text when a campaign names an agent and has no script of
 * its own (apps/api/src/campaigns/campaign-script.ts). The page prefills the same text so
 * what someone reads in the box is what would be saved. Change both together.
 */
export function scriptFromAgent(agent: AgentScript): string | null {
  const sections: string[] = [];

  const opening = agent.openingMessage?.trim();
  if (opening) sections.push(`Opening\n${opening}`);

  const questions = (agent.qualificationQuestions ?? []).filter((entry) => entry.question?.trim());
  if (questions.length > 0) {
    const lines = questions.map(
      (entry, index) =>
        `${index + 1}. ${entry.question.trim()}${entry.required ? " (must ask)" : ""}`,
    );
    sections.push(`Questions to ask\n${lines.join("\n")}`);
  }

  const objections = (agent.objectionHandling ?? []).filter(
    (entry) => entry.objection?.trim() && entry.response?.trim(),
  );
  if (objections.length > 0) {
    const lines = objections.map(
      (entry) => `- "${entry.objection.trim()}": ${entry.response.trim()}`,
    );
    sections.push(`If they object\n${lines.join("\n")}`);
  }

  const closing = agent.closingInstructions?.trim();
  if (closing) sections.push(`Closing\n${closing}`);

  if (sections.length === 0) return null;

  const script = sections.join("\n\n");
  if (script.length <= MAX_CALL_SCRIPT_LENGTH) return script;
  const cut = script.slice(0, MAX_CALL_SCRIPT_LENGTH);
  const lastBreak = cut.lastIndexOf("\n");
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd();
}

/** One line of the activation checklist. */
export interface ReadinessItem {
  key: "agent" | "script" | "leads";
  label: string;
  done: boolean;
}

/**
 * What activation will check, in the order the API reports it. It mirrors
 * CampaignsService.transition and decides nothing: the API still refuses with its own
 * sentence. It exists so the page can show what is missing before anyone presses the
 * button, rather than after.
 *
 * Only an AI calling campaign needs an agent and a script, as on the server.
 */
export function campaignReadiness(
  campaign: Pick<ApiCampaign, "type" | "aiAgentId" | "callScript" | "stats">,
): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  if (campaign.type === "AI_CALLING") {
    items.push({
      key: "agent",
      label: "An AI agent is assigned",
      done: Boolean(campaign.aiAgentId),
    });
    items.push({
      key: "script",
      label: "The call script is written",
      done: Boolean(campaign.callScript?.trim()),
    });
  }
  items.push({
    key: "leads",
    label: "At least one lead is added",
    done: campaign.stats.leads > 0,
  });
  return items;
}

/** 600 -> "10:00". */
export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "10:00" -> 600. Anything unreadable is null, so an emptied time box means "not set". */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** "2026-11-02T00:00:00.000Z" -> "2026-11-02", the value a date input holds. */
export function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/**
 * ICU lists some zones under names IANA has since replaced, and browsers that use it
 * offer "Asia/Calcutta" for India. The picker shows the current name; the API accepts
 * both and resolves them to the same zone.
 */
const CURRENT_ZONE_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Enderbury": "Pacific/Kanton",
};

/** For a browser without Intl.supportedValuesOf: the zones this product's customers use. */
const FALLBACK_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Colombo",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
];

/**
 * The zones the timezone picker offers: the browser's own IANA list under current names,
 * sorted, plus `current` if a campaign already holds a zone the list does not.
 */
export function timezoneOptions(
  current?: string | null,
  supported: () => string[] = () => Intl.supportedValuesOf("timeZone"),
): string[] {
  let zones: string[];
  try {
    zones = supported();
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = FALLBACK_ZONES;

  const names = new Set(zones.map((zone) => CURRENT_ZONE_NAMES[zone] ?? zone));
  names.add("UTC");
  if (current) names.add(current);
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * The campaign page's settings form. Every field is held as text, so a box can be empty
 * while it is retyped, and an empty optional field means "use the workspace's setting".
 */
export interface CampaignSettingsForm {
  aiAgentId: string;
  callScript: string;
  /** "" is the workspace's calling timezone. */
  timezone: string;
  /** "HH:MM", or "" on both for the workspace's hours. */
  windowStart: string;
  windowEnd: string;
  /** Empty: the workspace's calling days. */
  callDays: number[];
  /** "YYYY-MM-DD" or "". */
  startDate: string;
  endDate: string;
  /** "" is the workspace's daily cap. */
  dailyCallLimit: string;
  maxAttempts: string;
  retryDelayMinutes: string;
}

export function settingsForm(campaign: ApiCampaign): CampaignSettingsForm {
  return {
    aiAgentId: campaign.aiAgentId ?? "",
    callScript: campaign.callScript ?? "",
    timezone: campaign.timezone ?? "",
    windowStart: campaign.callWindowStart === null ? "" : minutesToTime(campaign.callWindowStart),
    windowEnd: campaign.callWindowEnd === null ? "" : minutesToTime(campaign.callWindowEnd),
    callDays: [...campaign.callDays].sort((a, b) => a - b),
    startDate: toDateInput(campaign.startDate),
    endDate: toDateInput(campaign.endDate),
    dailyCallLimit: campaign.dailyCallLimit === null ? "" : String(campaign.dailyCallLimit),
    maxAttempts: String(campaign.maxAttempts),
    retryDelayMinutes: String(campaign.retryDelayMinutes),
  };
}

/** A whole number within bounds, or null. */
function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return parsed >= min && parsed <= max ? parsed : null;
}

/**
 * What the API would refuse this form for, in its own words, so the page can say so
 * before the request rather than after. The API checks all of it again.
 */
export function settingsProblems(form: CampaignSettingsForm): string[] {
  const problems: string[] = [];

  const start = form.windowStart ? timeToMinutes(form.windowStart) : null;
  const end = form.windowEnd ? timeToMinutes(form.windowEnd) : null;
  if ((start === null) !== (end === null)) {
    problems.push(
      "Set both ends of the calling window, or clear both to use the workspace's hours.",
    );
  } else if (start !== null && end !== null && end <= start) {
    problems.push("The calling window must end after it starts.");
  }

  if (form.startDate && form.endDate && form.endDate <= form.startDate) {
    problems.push("The end date must be after the start date.");
  }

  if (form.dailyCallLimit.trim() && wholeNumber(form.dailyCallLimit, 1, 10_000) === null) {
    problems.push("Calls per day must be a whole number from 1 to 10,000, or empty.");
  }
  if (wholeNumber(form.maxAttempts, 1, 10) === null) {
    problems.push("Attempts per lead must be a whole number from 1 to 10.");
  }
  if (wholeNumber(form.retryDelayMinutes, 5, 10_080) === null) {
    problems.push("The wait between attempts must be from 5 to 10,080 minutes (a week).");
  }
  if (form.callScript.length > MAX_CALL_SCRIPT_LENGTH) {
    problems.push(
      `The call script is longer than ${MAX_CALL_SCRIPT_LENGTH.toLocaleString("en-IN")} characters.`,
    );
  }

  return problems;
}

/**
 * The PATCH for a form with no problems. Every field is sent: empty ones as null, which
 * the API reads as "use the workspace's setting". `calling` is false for a campaign type
 * that does not dial, which leaves its agent and script alone.
 */
export function settingsPatch(
  form: CampaignSettingsForm,
  calling: boolean,
): Partial<CampaignSettingsInput> {
  return {
    ...(calling
      ? {
          aiAgentId: form.aiAgentId || null,
          callScript: form.callScript.trim() ? form.callScript : null,
        }
      : {}),
    timezone: form.timezone || null,
    callWindowStart: form.windowStart ? timeToMinutes(form.windowStart) : null,
    callWindowEnd: form.windowEnd ? timeToMinutes(form.windowEnd) : null,
    callDays: form.callDays,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    dailyCallLimit: form.dailyCallLimit.trim() ? Number(form.dailyCallLimit.trim()) : null,
    maxAttempts: Number(form.maxAttempts.trim()),
    retryDelayMinutes: Number(form.retryDelayMinutes.trim()),
  };
}

/** "Mon–Fri", "Mon, Wed, Fri", "Every day" — the days a campaign or workspace calls on. */
export function describeDays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return "Every day";
  const ordered = WEEK_DAYS.filter((day) => days.includes(day.value));
  const positions = ordered.map((day) => WEEK_DAYS.indexOf(day));
  const consecutive = positions.every(
    (position, index) => index === 0 || position === positions[index - 1] + 1,
  );
  if (consecutive && ordered.length > 2) {
    return `${ordered[0].label}–${ordered[ordered.length - 1].label}`;
  }
  return ordered.map((day) => day.label).join(", ");
}
