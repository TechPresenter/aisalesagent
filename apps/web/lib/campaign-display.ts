import type { CampaignStatus, CampaignType } from "@/lib/api-client";
import type { Tone } from "@/lib/status";

/**
 * How campaign enums are shown.
 *
 * The database stores `AI_CALLING`; a person reads "AI Calling". Keeping the translation
 * here rather than inline means the label and its colour are decided once — the previous
 * arrangement had the display strings *as* the stored values, which is why the mock and
 * the API could not talk to each other at all.
 *
 * Tones follow the same semantic rule as everywhere else (lib/status.ts): green is
 * running well, blue is informational, amber needs attention, gray is inactive.
 */
export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "gray" },
  ACTIVE: { label: "Active", tone: "green" },
  // Amber rather than gray: a paused campaign is not finished, it is stopped and waiting
  // for someone to decide something.
  PAUSED: { label: "Paused", tone: "amber" },
  COMPLETED: { label: "Completed", tone: "blue" },
  ARCHIVED: { label: "Archived", tone: "gray" },
};

export const CAMPAIGN_TYPE: Record<CampaignType, { label: string; tone: Tone }> = {
  AI_CALLING: { label: "AI Calling", tone: "purple" },
  EMAIL: { label: "Email", tone: "blue" },
  WHATSAPP: { label: "WhatsApp", tone: "green" },
  MANUAL: { label: "Manual", tone: "gray" },
  MULTI_CHANNEL: { label: "Multi-channel", tone: "amber" },
};

/**
 * Which lifecycle buttons to offer for a campaign in a given state.
 *
 * Mirrors ALLOWED_TRANSITIONS in the API service, and deliberately only *hides* actions
 * the server would refuse — it never decides anything. The server remains the authority;
 * this exists so the UI does not offer a button whose only outcome is an error toast.
 */
export function availableActions(status: CampaignStatus): {
  action: "activate" | "pause" | "complete" | "archive";
  label: string;
  tone: "primary" | "neutral" | "danger";
}[] {
  switch (status) {
    case "DRAFT":
      return [
        { action: "activate", label: "Activate", tone: "primary" },
        { action: "archive", label: "Archive", tone: "neutral" },
      ];
    case "ACTIVE":
      return [
        { action: "pause", label: "Pause", tone: "neutral" },
        { action: "complete", label: "Complete", tone: "neutral" },
      ];
    case "PAUSED":
      return [
        { action: "activate", label: "Resume", tone: "primary" },
        { action: "complete", label: "Complete", tone: "neutral" },
      ];
    case "COMPLETED":
      return [{ action: "archive", label: "Archive", tone: "neutral" }];
    case "ARCHIVED":
      return [];
  }
}
