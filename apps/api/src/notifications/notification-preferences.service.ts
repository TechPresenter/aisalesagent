import { Injectable } from "@nestjs/common";
import {
  NotificationChannel,
  NotificationFrequency,
  NotificationType,
  Prisma,
} from "@prisma/client";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";

export interface NotificationPreferenceView {
  type: NotificationType;
  channels: NotificationChannel[];
  frequency: NotificationFrequency;
}

/**
 * The events Settings offers to be told about, in the order it lists them.
 *
 * A subset of the `NotificationType` enum on purpose: the billing and integration events
 * belong to features that are not built, and offering a switch for them would promise
 * something nothing can send.
 */
export const OFFERED_TYPES: NotificationType[] = [
  "NEW_LEAD",
  "INTERESTED_LEAD",
  "DEMO_BOOKED",
  "FOLLOWUP_DUE",
  "FOLLOWUP_OVERDUE",
  "CALL_COMPLETED",
  "CALL_FAILED",
  "CREDITS_LOW",
  "CREDITS_EXHAUSTED",
  "EXPORT_READY",
  "SYSTEM_ALERT",
];

/** What a user gets before they have chosen anything: the ones worth interrupting for. */
export const DEFAULT_CHANNELS: Partial<Record<NotificationType, NotificationChannel[]>> = {
  INTERESTED_LEAD: ["IN_APP", "EMAIL"],
  DEMO_BOOKED: ["IN_APP", "EMAIL"],
  FOLLOWUP_DUE: ["IN_APP"],
  FOLLOWUP_OVERDUE: ["IN_APP", "EMAIL"],
  CREDITS_LOW: ["IN_APP", "EMAIL"],
  CREDITS_EXHAUSTED: ["IN_APP", "EMAIL"],
  SYSTEM_ALERT: ["IN_APP"],
};

/**
 * Feature List §14 — Settings → Notifications.
 *
 * One row per user per event type, as the schema models it. Types the user has never
 * touched have no row, so the read fills them in from the defaults rather than showing
 * an empty screen — a person should see what they are currently set to receive, not a
 * blank form that means "the same thing".
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(userId: string): Promise<NotificationPreferenceView[]> {
    const rows = await this.db.notificationPreference.findMany({ where: { userId } });

    return OFFERED_TYPES.map((type) => {
      const row = rows.find((entry) => entry.type === type);
      return {
        type,
        channels: row?.channels ?? DEFAULT_CHANNELS[type] ?? ["IN_APP"],
        frequency: row?.frequency ?? NotificationFrequency.INSTANT,
      };
    });
  }

  /**
   * Saves the preferences a user submitted and returns the full set.
   *
   * Read-then-write rather than `upsert`: the scoped client adds the tenant to every
   * where clause, and Prisma will not take a compound unique key ("userId_type") and an
   * extra field in the same one. Finding by ordinary fields and writing by id says the
   * same thing in a form the scoping can rewrite.
   *
   * Sequential rather than concurrent: this is at most a dozen small writes, and the
   * development database serves one query at a time.
   */
  async update(
    userId: string,
    preferences: NotificationPreferenceView[],
  ): Promise<NotificationPreferenceView[]> {
    for (const preference of preferences) {
      if (!OFFERED_TYPES.includes(preference.type)) continue;

      const existing = await this.db.notificationPreference.findFirst({
        where: { userId, type: preference.type },
        select: { id: true },
      });

      if (existing) {
        await this.db.notificationPreference.update({
          where: { id: existing.id },
          data: { channels: preference.channels, frequency: preference.frequency },
        });
      } else {
        await this.db.notificationPreference.create({
          data: scopedCreate<Prisma.NotificationPreferenceUncheckedCreateInput>({
            userId,
            type: preference.type,
            channels: preference.channels,
            frequency: preference.frequency,
          }),
        });
      }
    }

    return this.list(userId);
  }
}
