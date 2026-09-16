/**
 * TRD §4 — User Roles & Personas. This list is the single source of truth: the Prisma
 * `Role` enum in apps/api mirrors it exactly, and the API has a compile-time check that
 * fails the build if the two ever drift apart.
 *
 * `AI Voice Agent` and `Prospect / Lead` from TRD §4 are deliberately absent — neither
 * is a platform login, so neither can appear in a JWT.
 */
export const ROLES = ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;

export type Role = (typeof ROLES)[number];

/**
 * Higher number = more authority. Used for "at least this role" checks so a new role can
 * be slotted in without rewriting every guard.
 */
export const ROLE_RANK: Record<Role, number> = {
  /// Read-only. Ranked below AGENT so every "at least AGENT" guard excludes it without
  /// having to name VIEWER explicitly.
  VIEWER: 5,
  AGENT: 10,
  MANAGER: 20,
  ADMIN: 30,
  OWNER: 40,
  SUPER_ADMIN: 100,
};

export function hasAtLeastRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * TRD §5: "the Super Admin role is the only one that can query across tenants, and every
 * cross-tenant action is audit-logged." Every cross-tenant exemption in the API routes
 * through this predicate rather than comparing to the string inline, so there is exactly
 * one place to audit.
 */
export function canCrossTenantBoundary(role: Role): boolean {
  return role === "SUPER_ADMIN";
}
