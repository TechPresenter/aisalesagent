import type { Call, FollowUp, Lead } from "@prisma/client";

/**
 * The shapes events carry, built in one place so a lead looks the same whether it
 * arrives in a webhook, a Slack message or an analytics event.
 *
 * Each includes a link back into the app, which is the thing a person reading a chat
 * message actually wants to do next.
 */

/** An absolute link into the web app: "/leads/abc" → "https://app.example.com/leads/abc". */
export function appUrl(path: string): string {
  const base =
    process.env.WEB_APP_URL?.trim() ||
    (process.env.API_CORS_ORIGINS ?? "").split(",")[0]?.trim() ||
    "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${path}`;
}

type LeadFields = Pick<
  Lead,
  "id" | "name" | "phone" | "city" | "source" | "status" | "score" | "createdAt"
>;

export function leadData(lead: LeadFields) {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    city: lead.city,
    source: lead.source,
    status: lead.status,
    score: lead.score,
    createdAt: lead.createdAt.toISOString(),
    url: appUrl(`/leads/${lead.id}`),
  };
}

type CallFields = Pick<
  Call,
  "id" | "leadId" | "campaignId" | "status" | "outcome" | "durationSeconds" | "startedAt" | "endedAt"
>;

export function callData(call: CallFields) {
  return {
    id: call.id,
    leadId: call.leadId,
    campaignId: call.campaignId,
    status: call.status,
    outcome: call.outcome,
    durationSeconds: call.durationSeconds,
    startedAt: call.startedAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    url: appUrl(`/leads/${call.leadId}`),
  };
}

type FollowUpFields = Pick<
  FollowUp,
  "id" | "leadId" | "assigneeId" | "dueAt" | "remindAt" | "channel" | "priority" | "notes"
>;

export function followUpData(followUp: FollowUpFields) {
  return {
    id: followUp.id,
    leadId: followUp.leadId,
    assigneeId: followUp.assigneeId,
    dueAt: followUp.dueAt.toISOString(),
    remindAt: followUp.remindAt?.toISOString() ?? null,
    channel: followUp.channel,
    priority: followUp.priority,
    notes: followUp.notes,
    url: appUrl("/follow-ups"),
  };
}
