import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { reportMessage } from "../common/error-reporting";
import { sendEmail } from "../integrations/vendors/email";
import { keepAlive } from "../runtime/vercel";
import type { MailKind } from "./mail-templates";

export interface OutgoingMail {
  /** What the message is, for logs. The templates in mail-templates.ts set it. */
  kind: MailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** The providers MAIL_DRIVER may name, besides `log`. */
const PROVIDERS = new Set(["sendgrid", "resend", "brevo"]);

export interface MailStatus {
  /** "log", "sendgrid", "resend", "brevo", or "none". */
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
 * `MAIL_DRIVER` picks the transport: `sendgrid`, `resend` or `brevo`, each with MAIL_API_KEY
 * and a MAIL_FROM on a domain verified with that provider. Outside production it defaults
 * to `log`, which writes each message to the API log so a developer can follow a reset
 * link without a mail account. In production `log` is refused: a log full of
 * password-reset links is a log full of account takeovers.
 *
 * For the same reason, every other line this service logs names a message by its kind,
 * never by its subject, which for a verification email is the code itself.
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

    if (PROVIDERS.has(driver)) {
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
      this.logger.error(`Email (${mail.kind}) to ${maskAddress(mail.to)} not sent: ${status.reason}`);
      reportMessage(`Platform email not sent: ${status.reason}`, "warning", {
        tags: { mailKind: mail.kind, mailDriver: status.driver },
      });
      return { ok: false, reason: `Email is not configured on this server (${status.reason}).` };
    }

    if (status.devLog) {
      // The whole message, subject and code included, is the point of the log driver, and
      // status() refuses it in production. This is the one place a subject is written out.
      this.logger.log(
        `\n──── ${mail.kind} email (not sent: MAIL_DRIVER=log) ────\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n──────────────────────────────────────────`,
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
      this.logger.warn(`Email (${mail.kind}) to ${maskAddress(mail.to)} failed: ${result.reason}`);
      // A provider refusing the platform's mail means nobody can reset a password or
      // verify an address until someone notices, and from the log alone nobody does.
      reportMessage("Platform email failed", "error", {
        tags: { mailKind: mail.kind, mailDriver: status.driver },
        extra: { reason: result.reason },
      });
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
