import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, type Webhook, type WebhookDelivery } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { TenantPrismaFactory } from "../../prisma/tenant-prisma.provider";
import { scopedCreate } from "../../prisma/tenant-scoped";
import { encryptCredentials, encryptionAvailable } from "../../providers/crypto.util";
import { catalogEntry } from "../catalog";
import type { CreateWebhookDto, UpdateWebhookDto } from "../dto/integrations.dto";
import { TEST_EVENT, type EventEnvelope } from "../events/event-types";
import { previewSecret, readSettings } from "../integration-settings";
import { checkOutboundUrl } from "../vendors/http";
import { generateWebhookSecret } from "./signing";
import { WebhookDeliveryService } from "./webhook-delivery.service";

/** Enough for every system a workspace plausibly feeds; a ceiling on a fan-out per event. */
const MAX_WEBHOOKS = 20;

export interface WebhookView {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** The integration that owns this endpoint (Zapier, Make…), when one does. */
  managedBy: string | null;
  lastDelivery: { status: string; responseStatus: number | null; createdAt: string } | null;
  failuresLast24h: number;
}

export interface DeliveryView {
  id: string;
  webhookId: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: unknown;
}

/**
 * TRD §8 — `CRUD /webhooks`: outbound event subscriptions a workspace configures.
 *
 * The signing secret is shown exactly once, in the response that creates or rotates it,
 * and is otherwise only ever decrypted inside the delivery service. Endpoints created by
 * an automation integration (Zapier, Make, n8n, Pabbly) are listed here too, because they
 * are ordinary webhooks underneath — but their URL and events belong to the integration,
 * so this screen can pause them and read their log, not rewire them.
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly deliveries: WebhookDeliveryService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(): Promise<WebhookView[]> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [hooks, managed, failures] = await Promise.all([
      this.db.webhook.findMany({
        orderBy: { createdAt: "asc" },
        include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } },
      }),
      this.managedWebhooks(),
      this.db.webhookDelivery.groupBy({
        by: ["webhookId"],
        where: { createdAt: { gte: since }, status: { in: ["FAILED", "EXHAUSTED"] } },
        _count: { _all: true },
      }),
    ]);

    return hooks.map((hook) =>
      toWebhookView(
        hook,
        managed.get(hook.id) ?? null,
        failures.find((row) => row.webhookId === hook.id)?._count._all ?? 0,
        hook.deliveries[0] ?? null,
      ),
    );
  }

  async create(dto: CreateWebhookDto): Promise<{ webhook: WebhookView; secret: string }> {
    this.requireEncryption();

    const check = await checkOutboundUrl(dto.url);
    if (!check.ok) throw new BadRequestException(check.reason);

    if ((await this.db.webhook.count()) >= MAX_WEBHOOKS) {
      throw new BadRequestException(`A workspace can have up to ${MAX_WEBHOOKS} webhooks.`);
    }

    const secret = generateWebhookSecret();
    const hook = await this.db.webhook.create({
      data: scopedCreate<Prisma.WebhookUncheckedCreateInput>({
        url: check.url.toString(),
        secretEncrypted: encryptCredentials(secret),
        events: unique(dto.events),
        description: dto.description?.trim() || null,
        isActive: true,
      }),
    });

    return { webhook: toWebhookView(hook, null, 0, null), secret };
  }

  async update(id: string, dto: UpdateWebhookDto): Promise<WebhookView> {
    const hook = await this.find(id);
    const managedBy = (await this.managedWebhooks()).get(id) ?? null;

    if (managedBy && (dto.url !== undefined || dto.events !== undefined)) {
      throw new BadRequestException(
        `This endpoint belongs to the ${managedBy} integration. Change its URL and events there.`,
      );
    }

    const data: Prisma.WebhookUpdateInput = {};
    if (dto.url !== undefined) {
      const check = await checkOutboundUrl(dto.url);
      if (!check.ok) throw new BadRequestException(check.reason);
      data.url = check.url.toString();
    }
    if (dto.events !== undefined) data.events = unique(dto.events);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.description !== undefined) data.description = dto.description.trim() || null;

    const updated = await this.db.webhook.update({ where: { id: hook.id }, data });
    return toWebhookView(updated, managedBy, 0, null);
  }

  async rotateSecret(id: string): Promise<{ secret: string }> {
    this.requireEncryption();
    const hook = await this.find(id);
    const secret = generateWebhookSecret();
    await this.db.webhook.update({
      where: { id: hook.id },
      data: { secretEncrypted: encryptCredentials(secret) },
    });
    return { secret };
  }

  async remove(id: string): Promise<void> {
    const hook = await this.find(id);
    const managedBy = (await this.managedWebhooks()).get(id);
    if (managedBy) {
      throw new BadRequestException(
        `This endpoint belongs to the ${managedBy} integration. Disconnect it there instead.`,
      );
    }
    await this.db.webhook.delete({ where: { id: hook.id } });
  }

  /** Sends a `test.ping` now and returns what the endpoint said. Never retried. */
  async test(id: string): Promise<DeliveryView> {
    const hook = await this.find(id);
    const { tenantId } = this.tenantPrisma.context;

    const envelope: EventEnvelope = {
      id: `evt_${randomUUID()}`,
      event: TEST_EVENT,
      createdAt: new Date().toISOString(),
      workspaceId: tenantId,
      data: { message: "A test event sent from Appsgain Settings.", webhookId: hook.id },
    };

    const delivery = await this.deliveries.enqueue(tenantId, hook.id, envelope, { retry: false });
    const attempted = await this.deliveries.attempt(tenantId, delivery.id, { retry: false });
    return toDeliveryView(attempted ?? delivery);
  }

  async deliveryLog(id: string, limit = 25): Promise<DeliveryView[]> {
    const hook = await this.find(id);
    const rows = await this.db.webhookDelivery.findMany({
      where: { webhookId: hook.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(toDeliveryView);
  }

  /**
   * Sends a past delivery's payload again, as a new delivery. The envelope keeps its id,
   * so a receiver that de-duplicates on it can tell a redelivery from a new event.
   */
  async redeliver(deliveryId: string): Promise<DeliveryView> {
    const original = await this.db.webhookDelivery.findFirst({ where: { id: deliveryId } });
    if (!original) throw new NotFoundException("Delivery not found");

    const { tenantId } = this.tenantPrisma.context;
    const envelope = original.payload as unknown as EventEnvelope;
    const copy = await this.deliveries.enqueue(tenantId, original.webhookId, envelope, { retry: false });
    const attempted = await this.deliveries.attempt(tenantId, copy.id, { retry: false });
    return toDeliveryView(attempted ?? copy);
  }

  private async find(id: string): Promise<Webhook> {
    const hook = await this.db.webhook.findFirst({ where: { id } });
    if (!hook) throw new NotFoundException("Webhook not found");
    return hook;
  }

  /** webhook id → the name of the automation integration that owns it. */
  private async managedWebhooks(): Promise<Map<string, string>> {
    const rows = await this.db.integration.findMany({
      where: { category: "AUTOMATION" },
      select: { provider: true, settings: true },
    });
    const managed = new Map<string, string>();
    for (const row of rows) {
      const webhookId = readSettings(row.settings).webhookId;
      if (webhookId) managed.set(webhookId, catalogEntry(row.provider)?.name ?? row.provider);
    }
    return managed;
  }

  private requireEncryption(): void {
    if (!encryptionAvailable()) {
      throw new ServiceUnavailableException(
        "CREDENTIALS_ENCRYPTION_KEY is not set on the server, so signing secrets cannot be stored.",
      );
    }
  }
}

function unique(events: string[]): string[] {
  return Array.from(new Set(events));
}

function toWebhookView(
  hook: Webhook,
  managedBy: string | null,
  failuresLast24h: number,
  last: WebhookDelivery | null,
): WebhookView {
  return {
    id: hook.id,
    // An automation platform's hook URL is itself the credential; show only enough to recognise it.
    url: managedBy ? previewSecret(hook.url) : hook.url,
    description: hook.description,
    events: hook.events,
    isActive: hook.isActive,
    createdAt: hook.createdAt.toISOString(),
    updatedAt: hook.updatedAt.toISOString(),
    managedBy,
    lastDelivery: last
      ? {
          status: last.status,
          responseStatus: last.responseStatus,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
    failuresLast24h,
  };
}

function toDeliveryView(row: WebhookDelivery): DeliveryView {
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    error: row.error,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    payload: row.payload,
  };
}
