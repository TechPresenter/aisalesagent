import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  hasPermission,
  permissionsFor,
  type Permission,
  type Role,
} from "@appsgain/shared";

/**
 * The permission table decides who can spend money, export a customer list and delete
 * other people's work. A mistake here is a privilege escalation, and it is exactly the
 * kind of mistake that is invisible in review — one extra string in an array reads the
 * same as any other.
 *
 * So these tests assert the *shape* of the model rather than restating the table: that
 * seniority is monotonic, that nothing is orphaned, and that the dangerous grants are
 * where they are supposed to be.
 */
describe("permission model", () => {
  const WORKSPACE_ROLES: Role[] = ["VIEWER", "AGENT", "MANAGER", "ADMIN", "OWNER"];

  it("grants every role only permissions that exist in the catalogue", () => {
    for (const role of ROLES) {
      const unknown = ROLE_PERMISSIONS[role].filter(
        (permission) => !(PERMISSIONS as readonly string[]).includes(permission),
      );
      expect({ role, unknown }).toEqual({ role, unknown: [] });
    }
  });

  it("nests workspace roles, so seniority never removes a capability", () => {
    // The property that makes the ladder safe to reason about: promoting someone can
    // only add. If ADMIN ever loses something MANAGER has, a promotion becomes a
    // demotion for that capability and no reviewer would notice.
    for (let i = 1; i < WORKSPACE_ROLES.length; i += 1) {
      const junior = ROLE_PERMISSIONS[WORKSPACE_ROLES[i - 1]];
      const senior = ROLE_PERMISSIONS[WORKSPACE_ROLES[i]];
      const lost = junior.filter((permission) => !senior.includes(permission));

      expect({
        pair: `${WORKSPACE_ROLES[i - 1]} -> ${WORKSPACE_ROLES[i]}`,
        lost,
      }).toEqual({ pair: `${WORKSPACE_ROLES[i - 1]} -> ${WORKSPACE_ROLES[i]}`, lost: [] });
    }
  });

  it("gives the owner every permission", () => {
    const missing = PERMISSIONS.filter((p) => !ROLE_PERMISSIONS.OWNER.includes(p));
    expect(missing).toEqual([]);
  });

  it("leaves no permission ungranted to anyone", () => {
    // An orphan is either a permission nobody can ever hold — dead code guarding a route
    // no one can reach — or a role grant somebody forgot to add.
    const granted = new Set(WORKSPACE_ROLES.flatMap((role) => [...ROLE_PERMISSIONS[role]]));
    const orphans = PERMISSIONS.filter((permission) => !granted.has(permission));
    expect(orphans).toEqual([]);
  });

  it("keeps a viewer read-only", () => {
    // Derived from the key rather than listed, so a new write permission is caught the
    // day it is added instead of the day someone remembers to update this test.
    const writeVerbs = ["create", "edit", "delete", "manage", "import", "export", "start"];
    const writes = ROLE_PERMISSIONS.VIEWER.filter((permission) =>
      writeVerbs.some((verb) => permission.endsWith(`.${verb}`)),
    );
    expect(writes).toEqual([]);
  });

  it("withholds the money and identity permissions from everyone below ADMIN", () => {
    const sensitive: Permission[] = ["billing.manage", "credits.manage", "roles.manage", "team.manage"];
    for (const permission of sensitive) {
      expect({ permission, viewer: hasPermission("VIEWER", permission) }).toEqual({ permission, viewer: false });
      expect({ permission, agent: hasPermission("AGENT", permission) }).toEqual({ permission, agent: false });
      expect({ permission, manager: hasPermission("MANAGER", permission) }).toEqual({ permission, manager: false });
    }
  });

  it("reserves billing.manage for the owner", () => {
    // Spending the workspace's money is the one thing an admin cannot do on their own.
    expect(hasPermission("ADMIN", "billing.manage")).toBe(false);
    expect(hasPermission("OWNER", "billing.manage")).toBe(true);
  });

  it("grants a super admin nothing inside a workspace", () => {
    // Platform operators reach tenant data through the audited cross-tenant path, not by
    // quietly holding workspace grants.
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toEqual([]);
    expect(hasPermission("SUPER_ADMIN", "leads.view")).toBe(false);
  });

  describe("custom roles", () => {
    it("replaces the system grants rather than adding to them", () => {
      // The whole point of a custom role is building a *narrower* one. If custom
      // permissions were unioned with the base role, a workspace could never express
      // "an admin who cannot export", and every custom role would be a promotion.
      const narrowed = ["leads.view"];
      expect(hasPermission("ADMIN", "leads.view", narrowed)).toBe(true);
      expect(hasPermission("ADMIN", "leads.delete", narrowed)).toBe(false);
      expect(hasPermission("ADMIN", "billing.view", narrowed)).toBe(false);
    });

    it("cannot grant a permission that is not in the catalogue", () => {
      const bogus = ["leads.view", "leads.superuser"];
      expect(permissionsFor("AGENT", bogus)).toEqual(["leads.view"]);
    });

    it("treats an empty custom set as no access, not as a fallback to the base role", () => {
      // A role stripped to nothing must mean nothing. Falling back here would turn the
      // most restrictive configuration into the most permissive one.
      expect(hasPermission("OWNER", "leads.view", [])).toBe(false);
    });
  });
});
