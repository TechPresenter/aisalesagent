import { redactSecrets, vendorFetch, vendorMessage, type VendorResponse } from "./http";

/**
 * Notification email through SendGrid or Resend — whichever the workspace connected.
 *
 * Plain transactional mail, one recipient per message: a teammate should never see who
 * else a notice went to, and one bad address must not sink the rest.
 */

export type Credentials = Record<string, string>;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(
  provider: string,
  credentials: Credentials,
  message: EmailMessage,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const fromName = credentials.fromName?.trim() || "Appsgain";
  let response: VendorResponse;
  let vendor: string;

  switch (provider) {
    case "sendgrid":
      vendor = "SendGrid";
      response = await vendorFetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: credentials.fromEmail, name: fromName },
          subject: message.subject,
          content: [
            { type: "text/plain", value: message.text },
            { type: "text/html", value: message.html },
          ],
        }),
      });
      break;

    case "resend":
      vendor = "Resend";
      response = await vendorFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${fromName.replace(/[<>"]/g, "")} <${credentials.fromEmail}>`,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      break;

    default:
      return { ok: false, reason: `${provider} does not send email.` };
  }

  if (response.ok) return { ok: true };
  if (response.status === 0) return { ok: false, reason: `Could not reach ${vendor}: ${response.error}` };
  const detail = vendorMessage(response);
  return {
    ok: false,
    reason: `${vendor} refused the email (HTTP ${response.status}${
      detail ? `: ${redactSecrets(detail, [credentials.apiKey])}` : ""
    })`,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
