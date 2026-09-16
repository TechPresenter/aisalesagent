import { CATEGORY_ORDER, INTEGRATION_CATALOG } from "./catalog";
import { PLATFORM_EVENT_KEYS } from "./events/event-types";
import { analyticsEventFor } from "./vendors/analytics";
import { chatMessageFor } from "./vendors/chat";
import { freshsalesBase, isSalesforceInstance, splitName } from "./vendors/crm";
import { VERIFIERS } from "./vendors/verifiers";

/**
 * The catalogue is data, and data drifts: a provider added without a verifier would
 * store whatever was typed and call it connected. These tests keep every entry honest
 * about how it is checked and what it does.
 */
describe("integration catalogue", () => {
  it("has unique providers, and every category has at least one", () => {
    const providers = INTEGRATION_CATALOG.map((entry) => entry.provider);
    expect(new Set(providers).size).toBe(providers.length);
    for (const category of CATEGORY_ORDER) {
      expect(INTEGRATION_CATALOG.some((entry) => entry.category === category)).toBe(true);
    }
  });

  it("gives every pasted-credential provider a verifier, and OAuth providers their env names", () => {
    for (const entry of INTEGRATION_CATALOG) {
      if (entry.auth === "oauth") {
        expect({ provider: entry.provider, env: entry.oauthEnv }).toEqual({
          provider: entry.provider,
          env: expect.objectContaining({ clientId: expect.any(String), clientSecret: expect.any(String) }),
        });
        expect(entry.fields).toEqual([]);
      } else if (entry.category === "AUTOMATION") {
        expect(entry.fields.map((field) => field.key)).toEqual(["webhookUrl"]);
      } else {
        expect({ provider: entry.provider, verifier: typeof VERIFIERS[entry.provider] }).toEqual({
          provider: entry.provider,
          verifier: "function",
        });
      }
    }
  });

  it("has valid field definitions: unique keys, compiling patterns, secrets marked", () => {
    for (const entry of INTEGRATION_CATALOG) {
      const keys = entry.fields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const field of entry.fields) {
        if (field.pattern) expect(() => new RegExp(field.pattern as string)).not.toThrow();
        if (field.key === "webhookUrl") expect(field.secret).toBe(true);
      }
      expect(entry.does.length).toBeGreaterThan(0);
    }
  });

  it("only lets webhook-URL integrations post to the hosts they name", () => {
    for (const entry of INTEGRATION_CATALOG.filter((item) => item.auth === "webhook_url")) {
      // n8n is self-hosted by design, so it is the one that accepts any public host.
      if (entry.provider === "n8n") continue;
      expect({ provider: entry.provider, restricted: (entry.allowedHosts?.length ?? 0) > 0 }).toEqual({
        provider: entry.provider,
        restricted: true,
      });
    }
  });
});

describe("event rendering", () => {
  const envelope = {
    id: "evt_123e4567-e89b-12d3-a456-426614174000",
    event: "lead.created" as const,
    createdAt: "2026-09-16T10:00:00.000Z",
    workspaceId: "tenant-1",
    data: {
      lead: {
        id: "lead-1",
        name: "Priya <Sharma>",
        phone: "+919812345678",
        city: "Pune",
        source: "WEBSITE",
        status: "NEW",
        score: 40,
        url: "https://app.example.com/leads/lead-1",
      },
    },
  };

  it("renders every platform event as a chat message with a title", () => {
    for (const event of PLATFORM_EVENT_KEYS) {
      expect(chatMessageFor({ ...envelope, event }).title).toBeTruthy();
    }
    const message = chatMessageFor(envelope);
    expect(message.title).toBe("New lead: Priya <Sharma>");
    expect(message.link?.url).toBe("https://app.example.com/leads/lead-1");
  });

  it("sends analytics tools no names or phone numbers", () => {
    const event = analyticsEventFor(envelope);
    const serialised = JSON.stringify(event);
    expect(event.name).toBe("lead_created");
    expect(serialised).not.toContain("Priya");
    expect(serialised).not.toContain("+919812345678");
    expect(event.properties.lead_id).toBe("lead-1");
    expect(event.distinctId).toBe("lead-1");
  });
});

describe("CRM helpers", () => {
  it("splits names the way CRMs require: a last name always present", () => {
    expect(splitName("Priya Sharma")).toEqual({ first: "Priya", last: "Sharma" });
    expect(splitName("Anil Kumar Mehta")).toEqual({ first: "Anil Kumar", last: "Mehta" });
    expect(splitName("Madonna")).toEqual({ first: "", last: "Madonna" });
    expect(splitName("   ")).toEqual({ first: "", last: "Unknown" });
  });

  it("only builds Freshsales URLs on Freshworks hosts", () => {
    expect(freshsalesBase("acme.myfreshworks.com")).toBe("https://acme.myfreshworks.com/crm/sales/api");
    expect(freshsalesBase("acme.freshsales.io")).toBe("https://acme.freshsales.io/api");
    expect(freshsalesBase("acme.myfreshworks.com.evil.com")).toBeNull();
    expect(freshsalesBase("169.254.169.254")).toBeNull();
  });

  it("only sends Salesforce tokens to a Salesforce instance", () => {
    expect(isSalesforceInstance("https://acme.my.salesforce.com")).toBe(true);
    expect(isSalesforceInstance("https://acme--dev.sandbox.my.salesforce.com/")).toBe(true);
    expect(isSalesforceInstance("http://acme.my.salesforce.com")).toBe(false);
    expect(isSalesforceInstance("https://salesforce.com.evil.com")).toBe(false);
    expect(isSalesforceInstance(undefined)).toBe(false);
  });
});
