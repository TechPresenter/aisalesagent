import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type Notification, type NotificationType } from "@prisma/client";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import { NotificationPreferencesService } from "./notification-preferences.service";

/** One notification as the bell renders it. */
export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath: string | null;
  read: boolean;
  createdAt: string;
  /** True for notices addressed to the workspace rather than to one person. */
  workspaceWide: boolean;
}

export interface RaiseNotification {
  type: NotificationType;
  title: string;
  body: string;
  /** Where clicking it should go, e.g. "/leads/<id>". */
  linkPath?: string;
  resourceType?: string;
  resourceId?: string;
  /** Who it is for. Omitted means every member of the workspace. */
  userId?: string | null;
  /** Minutes within which the same notice about the same row is not written again. */
  dedupeMinutes?: number;
}

/**
 * Feature List §14 — in-app notifications: what the bell in the header shows.
 *
 * Written by the services that do the work — a call settling, a lead arriving, the wallet
 * crossing its low line — rather than polled into existence by the browser, so the list
 * is a record of what happened and not a rendering of the current state.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /**
   * Writes one notification.
   *
   * Deliberately never throws. A notification is a courtesy about work that has already
   * happened, so failing to write one must not fail the call, the import or the charge
   * that prompted it — the failure goes to the log and the work stands.
   */
  async raise(input: RaiseNotification): Promise<void> {
    try {
      // A person can switch an event off for themselves. A workspace-wide notice — the
      // wallet running dry — is not something one member gets to silence for everyone.
      if (input.userId && !(await this.wantsInApp(input.userId, input.type))) return;

      if (input.dedupeMinutes && input.resourceId) {
        const since = new Date(Date.now() - input.dedupeMinutes * 60_000);
        const recent = await this.db.notification.findFirst({
          where: { type: input.type, resourceId: input.resourceId, createdAt: { gte: since } },
          select: { id: true },
        });
        if (recent) return;
      }

      await this.db.notification.create({
        data: scopedCreate<Prisma.NotificationUncheckedCreateInput>({
          userId: input.userId ?? null,
          type: input.type,
          title: input.title,
          body: input.body,
          linkPath: input.linkPath ?? null,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
        }),
      });
    } catch (error) {
      this.logger.warn(
        `Could not raise a ${input.type} notification: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  /** The caller's bell: notices addressed to them, plus the workspace's own. */
  async list(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<NotificationView[]> {
    const rows = await this.db.notification.findMany({
      where: {
        OR: [{ userId }, { userId: null }],
        ...(options.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(options.limit ?? 20, 50),
    });

    return rows.map(toView);
  }

  async unreadCount(userId: string): Promise<number> {
    return this.db.notification.count({
      where: { OR: [{ userId }, { userId: null }], readAt: null },
    });
  }

  /**
   * Marks one notification read.
   *
   * A workspace-wide notice is read for everyone at once: it is about the workspace
   * rather than about one person, and the alternative is a read-receipt row per member
   * for a single line of text.
   */
  async markRead(userId: string, id: string): Promise<void> {
    await this.db.notification.updateMany({
      where: { id, readAt: null, OR: [{ userId }, { userId: null }] },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.db.notification.updateMany({
      where: { readAt: null, OR: [{ userId }, { userId: null }] },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  private async wantsInApp(userId: string, type: NotificationType): Promise<boolean> {
    const preferences = await this.preferences.list(userId);
    const preference = preferences.find((entry) => entry.type === type);
    // A type nobody has an opinion about still gets through: silence should be chosen,
    // not inherited from a list this service happens not to offer.
    return preference ? preference.channels.includes("IN_APP") : true;
  }
}

function toView(row: Notification): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
    workspaceWide: row.userId === null,
  };
}
