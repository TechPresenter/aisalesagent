import { createHash, randomBytes } from "node:crypto";
import { hasPermission, type Permission, type Role } from "@appsgain/shared";

/**
 * Feature List §14 — "Public REST API: API-key authenticated access for tenants".
 *
 * A key is `agk_` followed by 32 random base64url characters (192 bits). Only its SHA-256
 * is stored, so a database leak does not leak working keys, and only its first eight
 * characters are kept in the clear, so a person can tell their keys apart.
 */

export const API_KEY_PREFIX = "agk_";

/**
 * What a key may be scoped to: reading and writing the sales data an outside system would
 * sync, and nothing that administers the workspace. Keys cannot manage people, roles,
 * billing, settings, integrations, webhooks or other keys, whoever creates them — a
 * leaked key should be an incident about lead data, not a takeover.
 */
export const API_KEY_SCOPES = [
  "leads.view",
  "leads.create",
  "leads.edit",
  "leads.import",
  "leads.export",
  "campaigns.view",
  "calling.view",
  "followups.view",
  "followups.manage",
  "notes.view",
  "transcripts.view",
  "calendar.view",
  "calendar.manage",
  "agents.view",
  "analytics.view",
] as const satisfies readonly Permission[];

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const SCOPE_LABEL: Record<ApiKeyScope, string> = {
  "leads.view": "Read leads",
  "leads.create": "Create leads",
  "leads.edit": "Update leads",
  "leads.import": "Import leads",
  "leads.export": "Export leads",
  "campaigns.view": "Read campaigns",
  "calling.view": "Read calls",
  "followups.view": "Read follow-ups",
  "followups.manage": "Create and update follow-ups",
  "notes.view": "Read sales notes",
  "transcripts.view": "Read transcripts",
  "calendar.view": "Read the calendar",
  "calendar.manage": "Create and update calendar events",
  "agents.view": "Read AI agents",
  "analytics.view": "Read analytics",
};

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 8) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** A cheap shape check, so a random bearer token never costs a database lookup. */
export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length >= 20 && value.length <= 100;
}

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** Scopes a person with this role may put on a key: offered to keys at all, and held by them. */
export function grantableScopes(role: Role): ApiKeyScope[] {
  return API_KEY_SCOPES.filter((scope) => hasPermission(role, scope));
}

/**
 * What a key can actually do right now: its scopes, cut down to what its creator still
 * holds. A key does not outrank the person who made it — demote them, and their keys are
 * demoted with them on the very next request.
 */
export function effectiveScopes(scopes: readonly string[], creatorRole: Role): ApiKeyScope[] {
  return grantableScopes(creatorRole).filter((scope) => scopes.includes(scope));
}
