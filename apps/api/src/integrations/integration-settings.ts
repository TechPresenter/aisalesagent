import type { Prisma } from "@prisma/client";
import type { CatalogEntry } from "./catalog";

/**
 * The non-secret half of an integration row — `Integration.settings`, typed.
 *
 * Secrets live in `credentialsEncrypted` and nowhere else. What is kept here is what the
 * Settings screen needs to render a connection without decrypting anything: a label for
 * the account, whether it was verified, the events it receives, and a preview of each
 * field that shows enough to recognise a key but not enough to use it.
 */
export interface IntegrationSettings {
  /** A non-secret label from verification: an account name, a bucket, an email address. */
  account?: string | null;
  /** False when the vendor offers no way to check credentials and they were only stored. */
  verified?: boolean;
  lastVerifiedAt?: string;
  /** Events this integration receives (chat, automation, analytics). */
  events?: string[];
  /** CRMs: push new leads. */
  syncLeads?: boolean;
  /** Calendars: mirror Appsgain calendar events. */
  syncCalendar?: boolean;
  /** Automation providers: the webhook row that carries their events. */
  webhookId?: string;
  /** Field key → display value; secrets reduced to their last four characters. */
  preview?: Record<string, string>;
}

export function readSettings(value: Prisma.JsonValue | null | undefined): IntegrationSettings {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as unknown as IntegrationSettings)
    : {};
}

export function writeSettings(settings: IntegrationSettings): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(settings)) as Prisma.InputJsonValue;
}

/**
 * `sk-live-abcd…wxyz` → `••••wxyz`; a webhook URL → its host and last four characters.
 *
 * Four characters rather than the eight-and-four `maskSecret` shows for provider keys:
 * these previews are stored in plain JSON beside the ciphertext, so they should give away
 * as little as still lets a person tell two keys apart.
 */
export function previewSecret(value: string): string {
  const tail = value.length > 12 ? value.slice(-4) : "";
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return `${url.origin}/••••${tail}`;
  } catch {
    // Not a URL — an ordinary key.
  }
  return `••••${tail}`;
}

export function previewCredentials(
  entry: CatalogEntry,
  credentials: Record<string, string>,
): Record<string, string> {
  const preview: Record<string, string> = {};
  for (const field of entry.fields) {
    const value = credentials[field.key];
    if (!value) continue;
    preview[field.key] = field.secret ? previewSecret(value) : value;
  }
  return preview;
}
