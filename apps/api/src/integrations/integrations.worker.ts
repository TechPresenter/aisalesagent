import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationEventsService } from "./integration-events.service";
import { followUpData, leadData } from "./events/payloads";
import { WebhookDeliveryService } from "./webhooks/webhook-delivery.service";

/** How often the worker looks for due work. */
const TICK_MS = 30_000;

/** Follow-ups whose moment passed longer ago than this are not announced late. */
const FOLLOW_UP_LOOKBACK_MS = 24 * 3_600_000;

/**
 * The two jobs no request triggers: retrying webhook deliveries that failed, and
 * announcing follow-ups as they come due.
 *
 * This is one of the few places that reads through the unscoped PrismaService, because
 * its question — "what is due, in any workspace?" — has no single tenant to ask it of. It
 * reads ids and tenant ids only, and hands each row to tenant-scoped code before anything
 * is written or sent.
 *
 * In-process on a timer, deliberately modest. Several API instances would each run it;
 * that is safe — a delivery attempt is guarded per process and a follow-up is claimed
 * with a conditional update before it is announced — but it is not a queue, and the
 * Redis-backed job system in the TRD is where this belongs once there is more than one.
 */
@Injectable()
export class IntegrationsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationsWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: WebhookDeliveryService,
    private readonly events: IntegrationEventsService,
  ) {}

  onApplicationBootstrap(): void {
    // Tests drive these jobs directly; a timer would only outlive them.
    if (process.env.NODE_ENV === "test" || process.env.INTEGRATIONS_WORKER === "off") return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.retryDeliveries();
      await this.announceDueFollowUps();
    } catch (error) {
      this.logger.warn(
        `Integrations worker pass failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      this.running = false;
    }
  }

  async retryDeliveries(): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: "asc" },
      take: 25,
      select: { id: true, tenantId: true },
    });

    for (const row of due) {
      // eslint-disable-next-line no-await-in-loop
      await this.deliveries.attempt(row.tenantId, row.id, { retry: true });
    }
    return due.length;
  }

  /**
   * Emits `followup.due` once per follow-up, at its reminder time — or its due time when it
   * has no reminder.
   *
   * `reminderSentAt` is the claim: set with a conditional update before the event goes out,
   * so a second worker or a second pass cannot announce the same follow-up twice.
   * Rescheduling a follow-up clears it (see FollowUpsService.update and
   * CalendarService.update), which is what lets a moved follow-up come due again.
   */
  async announceDueFollowUps(): Promise<number> {
    const now = new Date();
    const since = new Date(now.getTime() - FOLLOW_UP_LOOKBACK_MS);

    const due = await this.prisma.followUp.findMany({
      where: {
        status: "PENDING",
        reminderSentAt: null,
        OR: [
          { remindAt: { lte: now, gte: since } },
          { remindAt: null, dueAt: { lte: now, gte: since } },
        ],
      },
      orderBy: { dueAt: "asc" },
      take: 50,
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            city: true,
            source: true,
            status: true,
            score: true,
            createdAt: true,
          },
        },
      },
    });

    let announced = 0;
    for (const followUp of due) {
      const db = this.prisma.forTenant(followUp.tenantId);
      // eslint-disable-next-line no-await-in-loop
      const claimed = await db.followUp.updateMany({
        where: { id: followUp.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 0) continue;

      this.events.emit(followUp.tenantId, "followup.due", {
        followUp: followUpData(followUp),
        lead: leadData(followUp.lead),
      });
      announced += 1;
    }
    return announced;
  }
}
