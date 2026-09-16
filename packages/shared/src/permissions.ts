import { ROLES, type Role } from "./roles";

/**
 * The permission catalogue — the single source of truth for what can be authorised.
 *
 * Lives in @appsgain/shared rather than in the API because both sides need it and they
 * need the *same* list: the web app hides a control the user cannot use, and the API
 * refuses the request if they try anyway. Those are two enforcement points for one fact,
 * and a fact stated twice drifts. Stated once, imported twice, it cannot.
 *
 * Hiding a button is a courtesy, not a control. Every permission here MUST also be
 * checked server-side; §6 of the build spec says so and it is the only half that matters.
 */

export const PERMISSIONS = [
  "dashboard.view",

  "leads.view",
  "leads.create",
  "leads.edit",
  "leads.delete",
  "leads.export",
  "leads.import",
  "leads.assign",

  "campaigns.view",
  "campaigns.create",
  "campaigns.edit",
  "campaigns.delete",

  "calling.view",
  "calling.start",
  "calling.manage",

  "recordings.view",
  "recordings.download",
  "recordings.delete",

  "transcripts.view",

  "notes.view",
  "notes.create",
  "notes.edit",
  "notes.delete",

  "followups.view",
  "followups.manage",

  "calendar.view",
  "calendar.manage",

  "agents.view",
  "agents.manage",

  "analytics.view",
  "analytics.export",

  "billing.view",
  "billing.manage",

  "credits.view",
  "credits.manage",

  "team.view",
  "team.manage",

  "roles.manage",

  "integrations.view",
  "integrations.manage",

  "webhooks.manage",
  "apikeys.manage",

  "settings.view",
  "settings.manage",

  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Grouping for the role editor, so the UI does not have to parse the key prefix. */
export const PERMISSION_CATEGORY: Record<Permission, string> = {
  "dashboard.view": "Dashboard",

  "leads.view": "Leads",
  "leads.create": "Leads",
  "leads.edit": "Leads",
  "leads.delete": "Leads",
  "leads.export": "Leads",
  "leads.import": "Leads",
  "leads.assign": "Leads",

  "campaigns.view": "Campaigns",
  "campaigns.create": "Campaigns",
  "campaigns.edit": "Campaigns",
  "campaigns.delete": "Campaigns",

  "calling.view": "Calling",
  "calling.start": "Calling",
  "calling.manage": "Calling",

  "recordings.view": "Recordings",
  "recordings.download": "Recordings",
  "recordings.delete": "Recordings",

  "transcripts.view": "Transcripts",

  "notes.view": "Sales Notes",
  "notes.create": "Sales Notes",
  "notes.edit": "Sales Notes",
  "notes.delete": "Sales Notes",

  "followups.view": "Follow-ups",
  "followups.manage": "Follow-ups",

  "calendar.view": "Calendar",
  "calendar.manage": "Calendar",

  "agents.view": "Agents",
  "agents.manage": "Agents",

  "analytics.view": "Analytics",
  "analytics.export": "Analytics",

  "billing.view": "Billing",
  "billing.manage": "Billing",

  "credits.view": "Credits",
  "credits.manage": "Credits",

  "team.view": "Team",
  "team.manage": "Team",

  "roles.manage": "Roles",

  "integrations.view": "Integrations",
  "integrations.manage": "Integrations",

  "webhooks.manage": "Developer",
  "apikeys.manage": "Developer",

  "settings.view": "Settings",
  "settings.manage": "Settings",

  "audit.view": "Audit",
};

/**
 * What each system role can do.
 *
 * Written out per role rather than derived from rank, because authority is not actually
 * a ladder: a MANAGER may delete a lead but not touch billing, while an ADMIN may do
 * both. Expressing that as "rank >= 20" would be wrong in a way that only shows up as a
 * privilege escalation, so the grants are explicit and greppable.
 *
 * SUPER_ADMIN is deliberately absent — it is the platform operator, not a workspace
 * member, and `canCrossTenantBoundary` is the only check that should ever grant it
 * anything inside a tenant.
 */
const VIEWER_GRANTS: Permission[] = [
  "dashboard.view",
  "leads.view",
  "campaigns.view",
  "calling.view",
  "recordings.view",
  "transcripts.view",
  "notes.view",
  "followups.view",
  "calendar.view",
  "agents.view",
  "analytics.view",
  // Seeing who else is in the workspace, by name and role. Kept at the lowest tier
  // deliberately: colleague names are already on every lead, call, note and follow-up a
  // viewer can read, so withholding the list protects nothing while breaking every
  // "assigned to" filter on those screens. Changing someone's role or access is
  // `team.manage`, which is a different permission entirely and starts at ADMIN.
  "team.view",
];

const AGENT_GRANTS: Permission[] = [
  ...VIEWER_GRANTS,
  "leads.create",
  "leads.edit",
  "calling.start",
  "recordings.download",
  "notes.create",
  "notes.edit",
  "followups.manage",
  "calendar.manage",
];

const MANAGER_GRANTS: Permission[] = [
  ...AGENT_GRANTS,
  "leads.delete",
  "leads.export",
  "leads.import",
  "leads.assign",
  "campaigns.create",
  "campaigns.edit",
  "calling.manage",
  "notes.delete",
  "agents.manage",
  "analytics.export",
  "settings.view",
];

const ADMIN_GRANTS: Permission[] = [
  ...MANAGER_GRANTS,
  "campaigns.delete",
  "recordings.delete",
  "credits.view",
  "billing.view",
  "team.manage",
  "roles.manage",
  "integrations.view",
  "integrations.manage",
  "webhooks.manage",
  "apikeys.manage",
  "settings.manage",
  "audit.view",
];

/** The owner holds everything, including the two that spend money. */
const OWNER_GRANTS: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [],
  OWNER: OWNER_GRANTS,
  ADMIN: ADMIN_GRANTS,
  MANAGER: MANAGER_GRANTS,
  AGENT: AGENT_GRANTS,
  VIEWER: VIEWER_GRANTS,
};

/**
 * The one predicate every authorisation decision goes through, on both sides of the
 * wire. `customPermissions` is supplied when the user holds a workspace-defined role,
 * in which case it replaces the system role's grants entirely rather than adding to
 * them — a custom role that could only ever widen access would be useless for building
 * a restricted one.
 */
export function hasPermission(
  role: Role,
  permission: Permission,
  customPermissions?: readonly string[],
): boolean {
  if (customPermissions) {
    return customPermissions.includes(permission);
  }
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(
  role: Role,
  customPermissions?: readonly string[],
): readonly Permission[] {
  if (customPermissions) {
    return PERMISSIONS.filter((p) => customPermissions.includes(p));
  }
  return ROLE_PERMISSIONS[role];
}

/** Runtime narrowing for a permission key that arrived as a string. */
export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Every role is accounted for above — a new role without grants fails the build here. */
const _everyRoleHasGrants: Record<Role, readonly Permission[]> = ROLE_PERMISSIONS;
void _everyRoleHasGrants;
void ROLES;
