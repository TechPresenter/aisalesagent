import { Injectable, Logger } from "@nestjs/common";
import type { CalendarEvent, Integration } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { decryptCredentials } from "../providers/crypto.util";
import { CALENDAR_SYNC_PROVIDERS, EVENT_RECEIVER_PROVIDERS, catalogEntry } from "./catalog";
import type { EventEnvelope, PlatformEvent } from "./events/event-types";
import { readSettings } from "./integration-settings";
import { OAuthService } from "./oauth.service";
import { analyticsEventFor, sendAnalyticsEvent } from "./vendors/analytics";
import {
  deleteExternalEvent,
  externalProviderKey,
  isCalendarProvider,
  upsertExternalEvent,
} from "./vendors/calendar";
import { chatMessageFor, isChatProvider, postChatMessage } from "./vendors/chat";
import { pushLeadToCrm } from "./vendors/crm";
import { dig, text } from "./vendors/http";
import { WebhookDeliveryService } from "./webhooks/webhook-delivery.service";

type Outcome = { ok: true } | { ok: false; reason: string };

/**
 * Where platform events go once something has happened.
 *
 * Services that do the work call `emit` and move on: the call settles, the lead saves, the
 * response goes back to the browser. Delivery then runs detached — webhooks, chat, analytics
 * and CRM sync all happen after the request that caused them has finished, because a slow
 * Slack must never be the reason saving a lead took ten seconds.
 *
 * The same holds for failure: nothing here throws into the caller. A delivery that fails is
 * recorded on the webhook's delivery log or the integration's last error, where Settings
 * shows it, and the work that produced the event stands.
 */
@Injectable()
export class IntegrationEventsService {
  private readonly logger = new Logger(IntegrationEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: WebhookDeliveryService,
    private readonly oauth: OAuthService,
  ) {}

  emit(tenantId: string, event: PlatformEvent, data: Record<string, unknown>): void {
    const envelope: EventEnvelope = {
      id: `evt_${randomUUID()}`,
      event,
      createdAt: new Date().toISOString(),
      workspaceId: tenantId,
      data,
    };

    void this.dispatch(tenantId, envelope).catch((error: unknown) =>
      this.logger.warn(`Could not dispatch ${event}: ${describe(error)}`),
    );
  }

  /** Mirrors an Appsgain calendar event onto a connected Google or Outlook calendar. */
  syncCalendarEvent(tenantId: string, action: "upsert" | "delete", event: CalendarEvent): void {
    void this.syncCalendar(tenantId, action, event).catch((error: unknown) =>
      this.logger.warn(`Could not sync calendar event ${event.id}: ${describe(error)}`),
    );
  }

  private async dispatch(tenantId: string, envelope: EventEnvelope): Promise<void> {
    const db = this.prisma.forTenant(tenantId);

    const hooks = await db.webhook.findMany({
      where: { isActive: true, events: { has: envelope.event } },
      select: { id: true },
    });
    for (const hook of hooks) {
      // eslint-disable-next-line no-await-in-loop
      const delivery = await this.deliveries.enqueue(tenantId, hook.id, envelope, { retry: true });
      // eslint-disable-next-line no-await-in-loop
      await this.deliveries.attempt(tenantId, delivery.id, { retry: true });
    }

    const integrations = await db.integration.findMany({
      where: { status: "CONNECTED", provider: { in: EVENT_RECEIVER_PROVIDERS } },
    });
    for (const integration of integrations) {
      // eslint-disable-next-line no-await-in-loop
      await this.deliverToIntegration(tenantId, integration, envelope);
    }
  }

  private async deliverToIntegration(
    tenantId: string,
    integration: Integration,
    envelope: EventEnvelope,
  ): Promise<void> {
    const entry = catalogEntry(integration.provider);
    if (!entry) return;
    const settings = readSettings(integration.settings);

    const wantsEvent =
      entry.features.includes("events") && (settings.events ?? []).includes(envelope.event);
    const wantsLead =
      entry.features.includes("lead_sync") &&
      envelope.event === "lead.created" &&
      settings.syncLeads !== false;
    if (!wantsEvent && !wantsLead) return;

    let outcome: Outcome;
    if (entry.auth === "oauth") {
      const token = await this.oauth.accessToken(tenantId, integration);
      outcome = token.ok
        ? await this.pushLead(integration.provider, { ...token.credentials }, envelope)
        : { ok: false, reason: token.reason };
    } else {
      const credentials = this.credentials(integration);
      if (!credentials) {
        outcome = { ok: false, reason: "The stored credentials could not be decrypted. Connect again." };
      } else if (wantsLead) {
        outcome = await this.pushLead(integration.provider, credentials, envelope);
      } else if (isChatProvider(integration.provider)) {
        const response = await postChatMessage(
          integration.provider,
          credentials.webhookUrl,
          chatMessageFor(envelope),
        );
        outcome = response.ok
          ? { ok: true }
          : {
              ok: false,
              reason:
                response.status === 0
                  ? `Could not reach ${entry.name}: ${response.error}`
                  : `${entry.name} refused the message (HTTP ${response.status}).`,
            };
      } else {
        outcome = await sendAnalyticsEvent(
          integration.provider,
          credentials,
          analyticsEventFor(envelope),
        );
      }
    }

    await this.prisma.forTenant(tenantId).integration.updateMany({
      where: { id: integration.id },
      data: outcome.ok
        ? { lastSyncAt: new Date(), lastError: null }
        : { lastError: `${envelope.event}: ${outcome.reason}`.slice(0, 500) },
    });
  }

  private async pushLead(
    provider: string,
    credentials: Record<string, string | undefined>,
    envelope: EventEnvelope,
  ): Promise<Outcome> {
    const lead = dig(envelope.data, "lead");
    const id = text(dig(lead, "id"));
    const name = text(dig(lead, "name"));
    const phone = text(dig(lead, "phone"));
    if (!id || !name || !phone) return { ok: false, reason: "The event carried no lead to sync." };

    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value === "string") clean[key] = value;
    }

    const result = await pushLeadToCrm(provider, clean, {
      id,
      name,
      phone,
      city: text(dig(lead, "city")) ?? null,
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  private async syncCalendar(
    tenantId: string,
    action: "upsert" | "delete",
    event: CalendarEvent,
  ): Promise<void> {
    const db = this.prisma.forTenant(tenantId);
    const connected = await db.integration.findMany({
      where: { status: "CONNECTED", provider: { in: CALENDAR_SYNC_PROVIDERS } },
      orderBy: { createdAt: "asc" },
    });

    // An event already copied somewhere stays with that calendar; a new one goes to the
    // first calendar with sync switched on. One copy per event, never one per calendar.
    const target = event.externalProvider
      ? connected.find(
          (row) =>
            isCalendarProvider(row.provider) &&
            externalProviderKey(row.provider) === event.externalProvider,
        )
      : connected.find((row) => readSettings(row.settings).syncCalendar !== false);

    if (!target || !isCalendarProvider(target.provider)) return;
    if (action === "delete" && !event.externalId) return;

    const token = await this.oauth.accessToken(tenantId, target);
    if (!token.ok) {
      await db.integration.updateMany({
        where: { id: target.id },
        data: { lastError: `Calendar sync: ${token.reason}`.slice(0, 500) },
      });
      return;
    }

    const result =
      action === "delete"
        ? await deleteExternalEvent(target.provider, token.credentials.accessToken, event.externalId as string)
        : await upsertExternalEvent(
            target.provider,
            token.credentials.accessToken,
            {
              title: event.title,
              description: event.description,
              location: event.location,
              startAt: event.startAt,
              endAt: event.endAt,
              allDay: event.allDay,
            },
            event.externalId,
          );

    if (!result.ok) {
      await db.integration.updateMany({
        where: { id: target.id },
        data: { lastError: `Calendar sync: ${result.reason}`.slice(0, 500) },
      });
      return;
    }

    await db.integration.updateMany({
      where: { id: target.id },
      data: { lastSyncAt: new Date(), lastError: null },
    });

    if (action === "upsert" && result.externalId) {
      // updateMany rather than update: the event may have been deleted while this ran.
      await db.calendarEvent.updateMany({
        where: { id: event.id },
        data: {
          externalProvider: externalProviderKey(target.provider),
          externalId: result.externalId,
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  private credentials(integration: Integration): Record<string, string> | null {
    if (!integration.credentialsEncrypted) return null;
    try {
      return JSON.parse(decryptCredentials(integration.credentialsEncrypted)) as Record<string, string>;
    } catch {
      return null;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
