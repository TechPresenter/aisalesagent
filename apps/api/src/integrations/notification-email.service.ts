import { Injectable, Logger } from "@nestjs/common";
import type { NotificationChannel, NotificationType } from "@prisma/client";
import { DEFAULT_CHANNELS } from "../notifications/notification-preferences.service";
import { PrismaService } from "../prisma/prisma.service";
import { decryptCredentials } from "../providers/crypto.util";
import { EMAIL_PROVIDERS } from "./catalog";
import { appUrl } from "./events/payloads";
import { escapeHtml, sendEmail } from "./vendors/email";

export interface EmailableNotification {
  type: NotificationType;
  title: string;
  body: string;
  linkPath: string | null;
  /** Null for workspace-wide notices, which go to everyone who asked for email. */
  userId: string | null;
}

/**
 * The email half of Settings → Notifications.
 *
 * Runs only when the workspace has connected SendGrid or Resend, and only to people whose
 * preference for that event includes Email at "As it happens". Digests are stored as a
 * preference but not sent — there is no scheduler to batch them yet — so a digest choice
 * means no email rather than an instant one the person did not ask for.
 */
@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  deliver(tenantId: string, notification: EmailableNotification): void {
    void this.send(tenantId, notification).catch((error: unknown) =>
      this.logger.warn(
        `Could not email a ${notification.type} notification: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      ),
    );
  }

  private async send(tenantId: string, notification: EmailableNotification): Promise<void> {
    const db = this.prisma.forTenant(tenantId);

    const integration = await db.integration.findFirst({
      where: { status: "CONNECTED", provider: { in: EMAIL_PROVIDERS } },
      orderBy: { createdAt: "asc" },
    });
    if (!integration?.credentialsEncrypted) return;

    const recipients = await this.recipients(tenantId, notification);
    if (recipients.length === 0) return;

    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse(decryptCredentials(integration.credentialsEncrypted)) as Record<string, string>;
    } catch {
      await db.integration.updateMany({
        where: { id: integration.id },
        data: { lastError: "The stored credentials could not be decrypted. Connect again." },
      });
      return;
    }

    const link = notification.linkPath ? appUrl(notification.linkPath) : appUrl("/");
    const footer =
      "You are receiving this because Email is switched on for this event in Settings → Notifications.";
    const text = `${notification.body}\n\nOpen in Appsgain: ${link}\n\n${footer}`;
    const html =
      `<p style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#1B2A41">${escapeHtml(notification.body)}</p>` +
      `<p><a href="${escapeHtml(link)}" style="font:600 14px -apple-system,Segoe UI,sans-serif;color:#237DF5">Open in Appsgain</a></p>` +
      `<p style="font:12px -apple-system,Segoe UI,sans-serif;color:#919BA5">${escapeHtml(footer)}</p>`;

    let lastError: string | null = null;
    let sent = 0;
    for (const to of recipients) {
      // eslint-disable-next-line no-await-in-loop
      const result = await sendEmail(integration.provider, credentials, {
        to,
        subject: notification.title,
        text,
        html,
      });
      if (result.ok) sent += 1;
      else lastError = result.reason;
    }

    await db.integration.updateMany({
      where: { id: integration.id },
      data: lastError
        ? { lastError: `Email: ${lastError}`.slice(0, 500), ...(sent > 0 ? { lastSyncAt: new Date() } : {}) }
        : { lastError: null, lastSyncAt: new Date() },
    });
  }

  private async recipients(tenantId: string, notification: EmailableNotification): Promise<string[]> {
    const db = this.prisma.forTenant(tenantId);
    const users = await db.user.findMany({
      where: { status: "ACTIVE", ...(notification.userId ? { id: notification.userId } : {}) },
      select: { id: true, email: true },
    });
    if (users.length === 0) return [];

    const preferences = await db.notificationPreference.findMany({
      where: { type: notification.type, userId: { in: users.map((user) => user.id) } },
    });

    return users
      .filter((user) => {
        const preference = preferences.find((row) => row.userId === user.id);
        const channels: NotificationChannel[] =
          preference?.channels ?? DEFAULT_CHANNELS[notification.type] ?? ["IN_APP"];
        const frequency = preference?.frequency ?? "INSTANT";
        return channels.includes("EMAIL") && frequency === "INSTANT";
      })
      .map((user) => user.email);
  }
}
