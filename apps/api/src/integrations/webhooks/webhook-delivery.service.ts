import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type WebhookDelivery } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { scopedCreate } from "../../prisma/tenant-scoped";
import { decryptCredentials } from "../../providers/crypto.util";
import type { EventEnvelope } from "../events/event-types";
import { checkOutboundUrl, vendorFetch } from "../vendors/http";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signWebhookPayload,
} from "./signing";

/** One delivery is tried this many times in all before it is given up on. */
export const MAX_ATTEMPTS = 6;

/**
 * Wait before retry n (after attempt n failed): 1 minute, 5, 30, 2 hours, 8 hours.
 * Roughly a working day in total, which rides out a deploy, an outage or a weekend-length
 * misconfiguration without hammering an endpoint that is simply down.
 */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 8 * 3_600_000];

/**
 * How far ahead a fresh delivery's retry time is set. The first attempt happens straight
 * away in-process; this only matters if the process dies before that attempt records its
 * result, in which case the worker picks the row up instead of it being lost.
 */
const CLAIM_MS = 2 * 60_000;

const RESPONSE_SNIPPET = 1_000;

export interface SendResult {
  ok: boolean;
  status: number;
  body: string | null;
  error: string | null;
}

/**
 * Delivers webhooks: signs them, sends them, records what happened, schedules retries.
 *
 * A singleton rather than request-scoped, because deliveries outlive requests — the
 * retry worker calls in here with no request at all. Every row it touches is reached
 * through `forTenant(tenantId)`, with the tenant id coming from the row being retried.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  /** Delivery ids being attempted right now, so the worker and a live dispatch never double-send. */
  private readonly inFlight = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  /** Records a delivery to attempt. `retry: false` is for tests and manual redeliveries. */
  enqueue(
    tenantId: string,
    webhookId: string,
    envelope: EventEnvelope,
    options: { retry: boolean },
  ): Promise<WebhookDelivery> {
    return this.prisma.forTenant(tenantId).webhookDelivery.create({
      data: scopedCreate<Prisma.WebhookDeliveryUncheckedCreateInput>({
        webhookId,
        event: envelope.event,
        payload: envelope as unknown as Prisma.InputJsonValue,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: options.retry ? new Date(Date.now() + CLAIM_MS) : null,
      }),
    });
  }

  /**
   * Makes one attempt at a delivery and records the result.
   *
   * Returns null only when another attempt at the same delivery is already running.
   */
  async attempt(
    tenantId: string,
    deliveryId: string,
    options: { retry: boolean },
  ): Promise<WebhookDelivery | null> {
    if (this.inFlight.has(deliveryId)) return null;
    this.inFlight.add(deliveryId);

    try {
      const db = this.prisma.forTenant(tenantId);
      const delivery = await db.webhookDelivery.findFirst({
        where: { id: deliveryId },
        include: { webhook: true },
      });
      if (!delivery) return null;
      if (delivery.status === "SUCCEEDED" || delivery.status === "EXHAUSTED") return delivery;

      if (!delivery.webhook.isActive) {
        // Parked rather than retried: a paused endpoint should not collect a backlog that
        // fires all at once when someone switches it back on.
        return db.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "FAILED", error: "The endpoint is paused.", nextAttemptAt: null },
        });
      }

      let secret: string | null = null;
      try {
        secret = decryptCredentials(delivery.webhook.secretEncrypted);
      } catch {
        secret = null;
      }

      const result: SendResult = secret
        ? await this.send(delivery.webhook.url, secret, delivery.payload, delivery.event, delivery.id)
        : {
            ok: false,
            status: 0,
            body: null,
            error: "The signing secret could not be decrypted. Rotate it to keep delivering.",
          };

      const attempts = delivery.attempts + 1;

      if (result.ok) {
        return db.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "SUCCEEDED",
            attempts,
            responseStatus: result.status,
            responseBody: result.body,
            error: null,
            deliveredAt: new Date(),
            nextAttemptAt: null,
          },
        });
      }

      const exhausted = !options.retry || attempts >= MAX_ATTEMPTS;
      if (exhausted && options.retry) {
        this.logger.warn(
          `Webhook delivery ${delivery.id} (${delivery.event}) gave up after ${attempts} attempts: ${result.error}`,
        );
      }

      return db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? "EXHAUSTED" : "FAILED",
          attempts,
          responseStatus: result.status || null,
          responseBody: result.body,
          error: result.error,
          nextAttemptAt: exhausted
            ? null
            : new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
        },
      });
    } finally {
      this.inFlight.delete(deliveryId);
    }
  }

  /** Signs and POSTs one payload. Never throws; every failure comes back as a result. */
  async send(
    url: string,
    secret: string,
    payload: unknown,
    event: string,
    deliveryId: string,
  ): Promise<SendResult> {
    // Checked at every send, not only when the URL was saved: DNS can change underneath it.
    const check = await checkOutboundUrl(url);
    if (!check.ok) return { ok: false, status: 0, body: null, error: check.reason };

    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await vendorFetch(check.url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Appsgain-Webhooks/1.0",
        [EVENT_HEADER]: event,
        [DELIVERY_HEADER]: deliveryId,
        [TIMESTAMP_HEADER]: String(timestamp),
        [SIGNATURE_HEADER]: signWebhookPayload(secret, timestamp, body),
      },
      body,
    });

    const snippet = response.text ? response.text.slice(0, RESPONSE_SNIPPET) : null;

    if (response.status === 0) {
      return { ok: false, status: 0, body: null, error: `No response: ${response.error}.` };
    }
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        status: response.status,
        body: snippet,
        error: "The endpoint answered with a redirect. Use the final URL; redirects are not followed.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body: snippet,
        error: `The endpoint answered HTTP ${response.status}.`,
      };
    }
    return { ok: true, status: response.status, body: snippet, error: null };
  }
}
