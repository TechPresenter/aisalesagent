import type { EventEnvelope } from "../events/event-types";
import { dig, text, vendorFetch, vendorMessage, type VendorResponse } from "./http";

/**
 * Analytics destinations: Google Analytics 4, Mixpanel and PostHog.
 *
 * Events leave without names or phone numbers. GA4's terms forbid sending personal data,
 * and none of these tools needs it to count a funnel — an id to join on and the lead's
 * stage are enough.
 */

export type Credentials = Record<string, string>;

export const MIXPANEL_HOSTS: Record<string, string> = {
  us: "https://api.mixpanel.com",
  eu: "https://api-eu.mixpanel.com",
  in: "https://api-in.mixpanel.com",
};

export const POSTHOG_HOSTS: Record<string, string> = {
  us: "https://us.i.posthog.com",
  eu: "https://eu.i.posthog.com",
};

type Scalar = string | number | boolean;

export interface AnalyticsEvent {
  name: string;
  distinctId: string;
  insertId: string;
  properties: Record<string, Scalar>;
}

export function analyticsEventFor(envelope: EventEnvelope): AnalyticsEvent {
  const data = envelope.data;
  const lead = dig(data, "lead");
  const call = dig(data, "call");
  const followUp = dig(data, "followUp");

  const candidates: Record<string, unknown> = {
    workspace_id: envelope.workspaceId,
    lead_id: dig(lead, "id") ?? dig(call, "leadId") ?? dig(followUp, "leadId"),
    lead_source: dig(lead, "source"),
    lead_status: dig(data, "status") ?? dig(lead, "status"),
    previous_status: dig(data, "previousStatus"),
    lead_score: dig(lead, "score"),
    city: dig(lead, "city"),
    call_id: dig(call, "id"),
    call_status: dig(call, "status"),
    call_outcome: dig(data, "outcome") ?? dig(call, "outcome"),
    previous_outcome: dig(data, "previousOutcome"),
    duration_seconds: dig(call, "durationSeconds"),
    campaign_id: dig(call, "campaignId"),
    followup_channel: dig(followUp, "channel"),
    followup_priority: dig(followUp, "priority"),
    imported: dig(data, "imported"),
    balance: dig(data, "balance"),
    exhausted: dig(data, "exhausted"),
  };

  const properties: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(candidates)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      properties[key] = typeof value === "string" ? value.slice(0, 100) : value;
    }
  }

  return {
    // GA4 event names allow letters, digits and underscores only.
    name: envelope.event.replace(/[^a-z0-9]+/gi, "_"),
    distinctId: text(properties.lead_id) ?? envelope.workspaceId,
    insertId: envelope.id.replace(/[^a-zA-Z0-9]/g, "").slice(-36),
    properties,
  };
}

export function sendGa4(
  credentials: Credentials,
  event: AnalyticsEvent,
  options: { validateOnly?: boolean } = {},
): Promise<VendorResponse> {
  const params = new URLSearchParams({
    measurement_id: credentials.measurementId,
    api_secret: credentials.apiSecret,
  });
  const path = options.validateOnly ? "debug/mp/collect" : "mp/collect";

  return vendorFetch(`https://www.google-analytics.com/${path}?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: event.distinctId,
      events: [{ name: event.name, params: { ...event.properties, engagement_time_msec: 1 } }],
    }),
  });
}

export function sendMixpanel(credentials: Credentials, event: AnalyticsEvent): Promise<VendorResponse> {
  const host = MIXPANEL_HOSTS[credentials.residency] ?? MIXPANEL_HOSTS.us;
  return vendorFetch(`${host}/track?verbose=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify([
      {
        event: event.name,
        properties: {
          ...event.properties,
          token: credentials.projectToken,
          distinct_id: event.distinctId,
          time: Math.floor(Date.now() / 1000),
          $insert_id: event.insertId,
        },
      },
    ]),
  });
}

export function sendPostHog(credentials: Credentials, event: AnalyticsEvent): Promise<VendorResponse> {
  const host = POSTHOG_HOSTS[credentials.host] ?? POSTHOG_HOSTS.us;
  return vendorFetch(`${host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: credentials.projectApiKey,
      event: event.name,
      distinct_id: event.distinctId,
      properties: { ...event.properties, $insert_id: event.insertId },
      timestamp: new Date().toISOString(),
    }),
  });
}

/** Sends one event to whichever analytics tool `provider` names. */
export async function sendAnalyticsEvent(
  provider: string,
  credentials: Credentials,
  event: AnalyticsEvent,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let response: VendorResponse;
  let vendor: string;

  switch (provider) {
    case "google_analytics":
      vendor = "Google Analytics";
      response = await sendGa4(credentials, event);
      break;
    case "mixpanel":
      vendor = "Mixpanel";
      response = await sendMixpanel(credentials, event);
      if (response.ok && dig(response.body, "status") !== 1) {
        return {
          ok: false,
          reason: `Mixpanel refused the event: ${text(dig(response.body, "error")) ?? "no reason given"}`,
        };
      }
      break;
    case "posthog":
      vendor = "PostHog";
      response = await sendPostHog(credentials, event);
      break;
    default:
      return { ok: false, reason: `${provider} is not an analytics integration.` };
  }

  if (response.ok) return { ok: true };
  if (response.status === 0) return { ok: false, reason: `Could not reach ${vendor}: ${response.error}` };
  const message = vendorMessage(response);
  return {
    ok: false,
    reason: `${vendor} refused the event (HTTP ${response.status}${message ? `: ${message}` : ""})`,
  };
}
