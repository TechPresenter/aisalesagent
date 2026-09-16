import type { EventEnvelope } from "../events/event-types";
import { appUrl } from "../events/payloads";
import { dig, text, vendorFetch, type VendorResponse } from "./http";

/**
 * Chat destinations: Slack, Microsoft Teams and Google Chat, each reached through the
 * incoming-webhook URL the workspace pasted in. No bot, no OAuth app, no SDK — a webhook
 * URL can post to one channel and do nothing else, which is exactly the access a
 * notification feed should have.
 */

export type ChatProvider = "slack" | "microsoft_teams" | "google_chat";

export function isChatProvider(provider: string): provider is ChatProvider {
  return provider === "slack" || provider === "microsoft_teams" || provider === "google_chat";
}

export interface ChatMessage {
  title: string;
  lines: string[];
  link?: { label: string; url: string };
}

export function postChatMessage(
  provider: ChatProvider,
  webhookUrl: string,
  message: ChatMessage,
): Promise<VendorResponse> {
  const body =
    provider === "slack"
      ? slackPayload(message)
      : provider === "microsoft_teams"
        ? teamsPayload(message)
        : googleChatPayload(message);

  return vendorFetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slackPayload(message: ChatMessage) {
  const lines = [`*${slackEscape(message.title)}*`, ...message.lines.map(slackEscape)];
  if (message.link) lines.push(`<${message.link.url}|${slackEscape(message.link.label)}>`);
  return {
    // `text` is what notifications and screen readers get; the block is what the channel shows.
    text: message.title,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
  };
}

function teamsPayload(message: ChatMessage) {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: message.title, weight: "Bolder", size: "Medium", wrap: true },
            ...message.lines.map((line) => ({ type: "TextBlock", text: line, wrap: true })),
          ],
          actions: message.link
            ? [{ type: "Action.OpenUrl", title: message.link.label, url: message.link.url }]
            : [],
        },
      },
    ],
  };
}

function googleChatPayload(message: ChatMessage) {
  const lines = [`*${message.title}*`, ...message.lines];
  if (message.link) lines.push(`<${message.link.url}|${message.link.label}>`);
  return { text: lines.join("\n") };
}

/** "NO_ANSWER" → "No answer". */
export function humanize(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const words = raw.toLowerCase().replace(/[_.]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function duration(seconds: unknown): string | undefined {
  if (typeof seconds !== "number" || seconds <= 0) return undefined;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What a platform event looks like as a chat message. */
export function chatMessageFor(envelope: EventEnvelope): ChatMessage {
  const data = envelope.data;
  const lead = dig(data, "lead");
  const leadName = text(dig(lead, "name")) ?? "a lead";
  const leadUrl = text(dig(lead, "url"));
  const openLead = leadUrl ? { label: "Open in Appsgain", url: leadUrl } : undefined;

  switch (envelope.event) {
    case "lead.created":
      return {
        title: `New lead: ${leadName}`,
        lines: [
          [text(dig(lead, "phone")), text(dig(lead, "city"))].filter(Boolean).join(" · "),
          `Source: ${humanize(dig(lead, "source"))}`,
        ].filter(Boolean),
        link: openLead,
      };

    case "leads.imported": {
      const skipped = Number(dig(data, "duplicates") ?? 0) + Number(dig(data, "rejected") ?? 0);
      return {
        title: `${String(dig(data, "imported") ?? 0)} leads imported`,
        lines: skipped > 0 ? [`${skipped} rows skipped as duplicates or invalid.`] : [],
        link: { label: "Open leads", url: appUrl("/leads") },
      };
    }

    case "lead.status_changed":
      return {
        title: `${leadName} moved to ${humanize(dig(data, "status"))}`,
        lines: [`Previously ${humanize(dig(data, "previousStatus")) || "unset"}.`],
        link: openLead,
      };

    case "call.completed": {
      const call = dig(data, "call");
      const outcome = humanize(dig(call, "outcome"));
      const length = duration(dig(call, "durationSeconds"));
      return {
        title: `Call with ${leadName} finished`,
        lines: [
          `Status: ${humanize(dig(call, "status"))}${outcome ? ` · Outcome: ${outcome}` : ""}`,
          length ? `Duration: ${length}` : "",
        ].filter(Boolean),
        link: openLead,
      };
    }

    case "call.outcome_changed":
      return {
        title: `Call outcome corrected for ${leadName}`,
        lines: [
          `${humanize(dig(data, "previousOutcome")) || "No outcome"} → ${humanize(dig(data, "outcome"))}`,
        ],
        link: openLead,
      };

    case "followup.due": {
      const followUp = dig(data, "followUp");
      const followUpsUrl = text(dig(followUp, "url"));
      return {
        title: `Follow-up due: ${leadName}`,
        lines: [
          `${humanize(dig(followUp, "channel"))} · ${humanize(dig(followUp, "priority"))} priority`,
          text(dig(followUp, "notes")) ?? "",
        ].filter(Boolean),
        link: followUpsUrl ? { label: "Open follow-ups", url: followUpsUrl } : openLead,
      };
    }

    case "credits.low_balance":
      return {
        title: dig(data, "exhausted") ? "Credits exhausted — calls will stop" : "Credits running low",
        lines: [
          `Balance: ${String(dig(data, "balance") ?? "?")} credits (warning line ${String(
            dig(data, "threshold") ?? "?",
          )}).`,
        ],
        link: { label: "Open billing", url: appUrl("/settings") },
      };

    default:
      return {
        title: "Appsgain test message",
        lines: ["If you can read this, the connection works."],
      };
  }
}
