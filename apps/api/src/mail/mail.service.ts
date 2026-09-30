import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sendEmail } from "../integrations/vendors/email";
import { keepAlive } from "../runtime/vercel";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailStatus {
  /** "log", "sendgrid", "resend", or "none". */
  driver: string;
  /** Whether a message handed to `send` can reach a person. */
  deliverable: boolean;
  /** True when messages are written to the API log instead of sent — development only. */
  devLog: boolean;
  reason?: string;
}

/**
 * The platform's own email: password resets, verification codes, invitations and security
 * notices. Separate from the SendGrid/Resend a workspace connects under Integrations,
 * which sends that workspace's notifications — these messages are the platform's, and
 * must work before any workspace has configured anything.
 *
 * `MAIL_DRIVER` picks the transport. Outside production it defaults to `log`, which writes
 * each message to the API log so a developer can follow a reset link without a mail
 * account. In production `log` is refused: a log full of password-reset links is a log
 * full of account takeovers.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const status = this.status();
    if (!status.deliverable) {
      this.logger.warn(
        `Email cannot be sent (${status.reason}). Password resets, verification codes and ` +
          "invitations will not reach anyone until MAIL_DRIVER is configured.",
      );
    } else if (status.devLog) {
      this.logger.log("MAIL_DRIVER=log: emails are written to this log instead of being sent.");
    }
  }

  status(): MailStatus {
    const driver = (this.config.get<string>("MAIL_DRIVER") ?? "").trim().toLowerCase();
    const production = this.config.get<string>("NODE_ENV") === "production";

    if (driver === "sendgrid" || driver === "resend") {
      const ready = Boolean(this.config.get<string>("MAIL_API_KEY") && this.config.get<string>("MAIL_FROM"));
      return {
        driver,
        deliverable: ready,
        devLog: false,
        reason: ready ? undefined : "MAIL_API_KEY and MAIL_FROM must both be set",
      };
    }

    if (driver === "" || driver === "log") {
      return production
        ? {
            driver: "none",
            deliverable: false,
            devLog: false,
            reason: "no email provider is configured for production",
          }
        : { driver: "log", deliverable: true, devLog: true };
    }

    return { driver, deliverable: false, devLog: false, reason: `MAIL_DRIVER "${driver}" is not supported` };
  }

  /**
   * Most callers do not wait for this — a reset request answers the same whether or not the
   * provider is slow — so the attempt registers itself with keepAlive, which on Vercel keeps
   * the function running until the provider has answered.
   */
  send(mail: OutgoingMail): Promise<{ ok: true } | { ok: false; reason: string }> {
    return keepAlive(this.deliver(mail));
  }

  private async deliver(mail: OutgoingMail): Promise<{ ok: true } | { ok: false; reason: string }> {
    const status = this.status();

    if (!status.deliverable) {
      this.logger.error(`Email "${mail.subject}" to ${maskAddress(mail.to)} not sent: ${status.reason}`);
      return { ok: false, reason: `Email is not configured on this server (${status.reason}).` };
    }

    if (status.devLog) {
      this.logger.log(
        `\n──── email (not sent: MAIL_DRIVER=log) ────\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n──────────────────────────────────────────`,
      );
      return { ok: true };
    }

    const result = await sendEmail(
      status.driver,
      {
        apiKey: this.config.get<string>("MAIL_API_KEY") ?? "",
        fromEmail: this.config.get<string>("MAIL_FROM") ?? "",
        fromName: this.config.get<string>("MAIL_FROM_NAME") ?? "Appsgain",
      },
      mail,
    );
    if (!result.ok) {
      this.logger.warn(`Email "${mail.subject}" to ${maskAddress(mail.to)} failed: ${result.reason}`);
    }
    return result;
  }
}

/** "priya.sharma@example.com" → "pr•••@example.com", for logs that should not collect addresses. */
export function maskAddress(address: string): string {
  const [local, domain] = address.split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 2)}•••@${domain}`;
}
