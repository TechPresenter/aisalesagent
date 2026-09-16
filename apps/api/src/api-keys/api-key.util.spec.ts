import { PERMISSIONS, hasPermission, type Role } from "@appsgain/shared";
import {
  API_KEY_SCOPES,
  SCOPE_LABEL,
  effectiveScopes,
  generateApiKey,
  grantableScopes,
  hashApiKey,
  looksLikeApiKey,
} from "./api-key.util";

/**
 * An API key is a credential that does not expire on its own and is usually pasted into
 * someone else's system, so its limits are the part worth testing: what it can never be
 * given, and how it shrinks when the person who made it loses access.
 */
describe("API key scopes", () => {
  it("never includes anything that administers the workspace", () => {
    const administrative = [
      "team.manage",
      "roles.manage",
      "billing.manage",
      "credits.manage",
      "settings.manage",
      "integrations.manage",
      "webhooks.manage",
      "apikeys.manage",
      "calling.manage",
      "calling.start",
      "leads.delete",
    ];
    for (const permission of administrative) {
      expect(API_KEY_SCOPES as readonly string[]).not.toContain(permission);
    }
  });

  it("offers only real permissions, each with a label", () => {
    for (const scope of API_KEY_SCOPES) {
      expect(PERMISSIONS as readonly string[]).toContain(scope);
      expect(SCOPE_LABEL[scope]).toBeTruthy();
    }
  });

  it("lets a role grant only what it holds itself", () => {
    const roles: Role[] = ["VIEWER", "AGENT", "MANAGER", "ADMIN", "OWNER"];
    for (const role of roles) {
      for (const scope of grantableScopes(role)) {
        expect(hasPermission(role, scope)).toBe(true);
      }
    }
    expect(grantableScopes("VIEWER")).toContain("leads.view");
    expect(grantableScopes("VIEWER")).not.toContain("leads.create");
    expect(grantableScopes("SUPER_ADMIN")).toEqual([]);
  });

  it("cuts a key down to its creator's current grants", () => {
    const scopes = ["leads.view", "leads.create", "leads.export"];
    expect(effectiveScopes(scopes, "MANAGER")).toEqual(["leads.view", "leads.create", "leads.export"]);
    // Demoted to AGENT: create survives, export does not.
    expect(effectiveScopes(scopes, "AGENT")).toEqual(["leads.view", "leads.create"]);
    // A scope that was never offered to keys is ignored even if it is in the row.
    expect(effectiveScopes(["team.manage"], "OWNER")).toEqual([]);
  });
});

describe("API key format", () => {
  it("generates a prefixed key whose stored hash matches and whose prefix is its start", () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key).toMatch(/^agk_[A-Za-z0-9_-]{32}$/);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prefix).toBe(key.slice(0, 8));
    expect(generateApiKey().key).not.toBe(key);
  });

  it("recognises key-shaped strings without a lookup, and nothing else", () => {
    expect(looksLikeApiKey(generateApiKey().key)).toBe(true);
    expect(looksLikeApiKey("eyJhbGciOiJIUzI1NiJ9.payload.signature")).toBe(false);
    expect(looksLikeApiKey("agk_short")).toBe(false);
  });
});
