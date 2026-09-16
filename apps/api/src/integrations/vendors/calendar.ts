import { dig, text, vendorFetch, vendorMessage, type VendorResponse } from "./http";

/**
 * Calendar sync: an event booked in Appsgain is mirrored onto Google Calendar or Outlook.
 *
 * Appsgain is the source of truth and the external calendar is the copy. Edits made on
 * the external side are not read back — that would need push subscriptions and a rule
 * about which edit wins — so a meeting moved in Google stays where Appsgain has it the
 * next time Appsgain changes it.
 */

export type CalendarProvider = "google_calendar" | "microsoft_outlook";

export function isCalendarProvider(provider: string): provider is CalendarProvider {
  return provider === "google_calendar" || provider === "microsoft_outlook";
}

/** The value stored in CalendarEvent.externalProvider, per the schema's comment. */
export function externalProviderKey(provider: CalendarProvider): "google" | "outlook" {
  return provider === "google_calendar" ? "google" : "outlook";
}

export interface CalendarEventInput {
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
}

export type CalendarSyncResult = { ok: true; externalId?: string } | { ok: false; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** All-day events are whole days, end exclusive — which both APIs insist on. */
function allDayRange(event: CalendarEventInput): { start: Date; end: Date } {
  const start = new Date(Date.UTC(
    event.startAt.getUTCFullYear(),
    event.startAt.getUTCMonth(),
    event.startAt.getUTCDate(),
  ));
  const endMidnight = new Date(Date.UTC(
    event.endAt.getUTCFullYear(),
    event.endAt.getUTCMonth(),
    event.endAt.getUTCDate(),
  ));
  const end =
    endMidnight.getTime() < event.endAt.getTime() ? new Date(endMidnight.getTime() + DAY_MS) : endMidnight;
  return { start, end: end.getTime() > start.getTime() ? end : new Date(start.getTime() + DAY_MS) };
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function googleBody(event: CalendarEventInput) {
  const range = event.allDay ? allDayRange(event) : null;
  return {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: range ? { date: ymd(range.start) } : { dateTime: event.startAt.toISOString() },
    end: range ? { date: ymd(range.end) } : { dateTime: event.endAt.toISOString() },
  };
}

function outlookBody(event: CalendarEventInput) {
  const range = event.allDay ? allDayRange(event) : { start: event.startAt, end: event.endAt };
  // Graph wants a local date-time plus a zone name rather than an ISO instant.
  const local = (date: Date) => date.toISOString().slice(0, 19);
  return {
    subject: event.title,
    body: { contentType: "text", content: event.description ?? "" },
    location: event.location ? { displayName: event.location } : undefined,
    start: { dateTime: local(range.start), timeZone: "UTC" },
    end: { dateTime: local(range.end), timeZone: "UTC" },
    isAllDay: event.allDay,
  };
}

function eventsUrl(provider: CalendarProvider, externalId?: string): string {
  const base =
    provider === "google_calendar"
      ? "https://www.googleapis.com/calendar/v3/calendars/primary/events"
      : "https://graph.microsoft.com/v1.0/me/events";
  return externalId ? `${base}/${encodeURIComponent(externalId)}` : base;
}

function vendorName(provider: CalendarProvider): string {
  return provider === "google_calendar" ? "Google Calendar" : "Outlook";
}

function failure(provider: CalendarProvider, response: VendorResponse): CalendarSyncResult {
  if (response.status === 0) {
    return { ok: false, reason: `Could not reach ${vendorName(provider)}: ${response.error}` };
  }
  const message = vendorMessage(response);
  return {
    ok: false,
    reason: `${vendorName(provider)} refused the event (HTTP ${response.status}${
      message ? `: ${message}` : ""
    })`,
  };
}

/** Creates the external copy, or updates it — recreating it if it was deleted over there. */
export async function upsertExternalEvent(
  provider: CalendarProvider,
  accessToken: string,
  event: CalendarEventInput,
  externalId: string | null,
): Promise<CalendarSyncResult> {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const body = JSON.stringify(provider === "google_calendar" ? googleBody(event) : outlookBody(event));

  if (externalId) {
    const updated = await vendorFetch(eventsUrl(provider, externalId), { method: "PATCH", headers, body });
    if (updated.ok) return { ok: true, externalId };
    if (updated.status !== 404 && updated.status !== 410) return failure(provider, updated);
    // Deleted on their side: fall through and create it again.
  }

  const created = await vendorFetch(eventsUrl(provider), { method: "POST", headers, body });
  if (!created.ok) return failure(provider, created);
  return { ok: true, externalId: text(dig(created.body, "id")) };
}

export async function deleteExternalEvent(
  provider: CalendarProvider,
  accessToken: string,
  externalId: string,
): Promise<CalendarSyncResult> {
  const response = await vendorFetch(eventsUrl(provider, externalId), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // Already gone is the outcome that was asked for.
  if (response.ok || response.status === 404 || response.status === 410) return { ok: true };
  return failure(provider, response);
}
