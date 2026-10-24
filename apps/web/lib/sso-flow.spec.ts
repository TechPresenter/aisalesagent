import type { SsoSignInResult } from "@appsgain/shared";
import { ApiError } from "./api-client";
import {
  dropForeignClerkClient,
  endSsoFlow,
  failSso,
  providerLabel,
  readSsoSignup,
  readSsoStart,
  rememberSsoStart,
  saveSsoSignup,
  spendSsoStart,
  ssoErrorMessage,
  ssoOrigin,
  ssoOutcome,
  takeSsoError,
  workspaceName,
} from "./sso-flow";

/**
 * The browser half of "Continue with Google / Microsoft" keeps its state in sessionStorage
 * across two redirects, and has to read the API's four answers correctly. Both are tested
 * here; the redirects themselves belong to Clerk and are not.
 */

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  keys() {
    return Array.from(this.items.keys());
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { sessionStorage: storage };
});

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

const SESSION = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 900,
  user: {
    id: "u1",
    email: "owner@northwind.test",
    name: "Owner",
    role: "OWNER" as const,
    tenantId: "t1",
    tenantName: "Northwind",
  },
};

describe("ssoOutcome", () => {
  it("reads a session, with and without passwordCleared", () => {
    expect(ssoOutcome(SESSION)).toEqual({ kind: "signed-in", passwordCleared: false });
    expect(ssoOutcome({ ...SESSION, passwordCleared: true })).toEqual({
      kind: "signed-in",
      passwordCleared: true,
    });
  });

  it("reads a 2FA challenge and keeps passwordCleared beside it, not inside it", () => {
    const outcome = ssoOutcome({
      twoFactorRequired: true,
      challengeToken: "challenge",
      expiresIn: 300,
      passwordCleared: true,
    });
    expect(outcome).toEqual({
      kind: "two-factor",
      challenge: { twoFactorRequired: true, challengeToken: "challenge", expiresIn: 300 },
      passwordCleared: true,
    });
  });

  it("reads a workspace choice and a sign-up", () => {
    const choice: SsoSignInResult = {
      status: "choose-workspace",
      selectionToken: "select",
      workspaces: [{ subdomain: "acme", name: "Acme" }],
      expiresIn: 300,
    };
    expect(ssoOutcome(choice)).toEqual({ kind: "choose-workspace", choice });

    const signup = {
      signupToken: "signup",
      email: "new@acme.test",
      name: "New Person",
      expiresIn: 900,
    };
    expect(ssoOutcome({ status: "signup-required", ...signup })).toEqual({
      kind: "signup-required",
      signup,
    });
  });
});

describe("the pending sign-up", () => {
  const signup = {
    status: "signup-required" as const,
    signupToken: "signup-token",
    email: "new@acme.test",
    name: null,
    expiresIn: 900,
  };

  it("round-trips with the provider that was pressed, until it expires", () => {
    rememberSsoStart({ provider: "microsoft", origin: "/sign-up" });
    saveSsoSignup(signup, 1_000);

    expect(readSsoSignup(1_000 + 899_000)).toEqual({
      signup: {
        signupToken: "signup-token",
        email: "new@acme.test",
        name: null,
        provider: "microsoft",
        fromSignIn: false,
        known: null,
        expiresAt: 901_000,
      },
      expired: false,
    });

    expect(readSsoSignup(901_000)).toEqual({ signup: null, expired: true });
    // Cleared, so the next read is simply "none" rather than "expired" again.
    expect(readSsoSignup(901_000)).toEqual({ signup: null, expired: false });
  });

  it("remembers that the person was signing in, and where else the address is known", () => {
    rememberSsoStart({ provider: "google", origin: "/sign-in" });
    // Spent by the exchange that answered with the sign-up; where it began is still known.
    spendSsoStart();
    saveSsoSignup({ ...signup, known: { reason: "invited", workspace: "Acme" } });

    expect(readSsoSignup().signup).toMatchObject({
      provider: "google",
      fromSignIn: true,
      known: { reason: "invited", workspace: "Acme" },
    });
  });

  it("treats a malformed entry as none, and clears it", () => {
    storage.setItem("appsgain.sso.signup", JSON.stringify({ email: "x@y.test" }));
    expect(readSsoSignup()).toEqual({ signup: null, expired: false });
    expect(storage.keys()).not.toContain("appsgain.sso.signup");

    storage.setItem("appsgain.sso.signup", "{not json");
    expect(readSsoSignup()).toEqual({ signup: null, expired: false });
  });

  it("is cleared together with the start of the flow", () => {
    rememberSsoStart({ provider: "google", origin: "/sign-in" });
    saveSsoSignup(signup);
    endSsoFlow();
    expect(storage.keys()).toEqual([]);
  });

  it("is never put anywhere but sessionStorage", () => {
    saveSsoSignup(signup);
    expect(storage.keys()).toEqual(["appsgain.sso.signup"]);
  });
});

describe("failing back to the start", () => {
  it("returns to the page the flow began on, with the message shown once", () => {
    rememberSsoStart({ provider: "google", origin: "/sign-up" });
    expect(failSso("Too many attempts.")).toBe("/sign-up");
    expect(takeSsoError()).toBe("Too many attempts.");
    expect(takeSsoError()).toBeNull();
  });

  it("defaults to sign-in when nothing was noted", () => {
    expect(readSsoStart()).toBeNull();
    expect(failSso("Nope.")).toBe("/sign-in");
  });

  it("ignores values it did not write", () => {
    storage.setItem(
      "appsgain.sso.start",
      JSON.stringify({
        provider: "github",
        origin: "https://evil.test",
        workspace: "Not A Workspace",
        nonce: "n",
        startedAt: Date.now(),
      }),
    );
    expect(readSsoStart()).toEqual({ provider: null, origin: "/sign-in", workspace: null });
    expect(ssoOrigin()).toBe("/sign-in");
  });

  it("works with no storage at all", () => {
    delete (globalThis as { window?: unknown }).window;
    rememberSsoStart({ provider: "google", origin: "/sign-up" });
    expect(failSso("Gone.")).toBe("/sign-in");
    expect(takeSsoError()).toBeNull();
    expect(readSsoSignup()).toEqual({ signup: null, expired: false });
  });
});

describe("the flow this tab started", () => {
  it("exists only from the button press until the token is traded", () => {
    expect(readSsoStart()).toBeNull();

    rememberSsoStart({ provider: "google", origin: "/sign-up", workspace: " Acme " });
    expect(readSsoStart()).toEqual({ provider: "google", origin: "/sign-up", workspace: "acme" });

    spendSsoStart();
    // A reload or a Back to the return page now finds nothing to go on with…
    expect(readSsoStart()).toBeNull();
    // …but the steps still to come know where to start over.
    expect(ssoOrigin()).toBe("/sign-up");
  });

  it("is not something another tab's page or an old entry can stand in for", () => {
    storage.setItem(
      "appsgain.sso.start",
      JSON.stringify({ provider: "google", origin: "/sign-in" }),
    );
    expect(readSsoStart()).toBeNull();
  });

  it("lapses when the press was so long ago that it was plainly abandoned", () => {
    rememberSsoStart({ provider: "google", origin: "/sign-in" }, 1_000);
    expect(readSsoStart(1_000 + 29 * 60_000)).not.toBeNull();
    expect(readSsoStart(1_000 + 31 * 60_000)).toBeNull();
  });

  it("is marked with a fresh random value each time", () => {
    rememberSsoStart({ provider: "google", origin: "/sign-in" });
    const first = JSON.parse(storage.getItem("appsgain.sso.start")!).nonce;
    rememberSsoStart({ provider: "google", origin: "/sign-in" });
    const second = JSON.parse(storage.getItem("appsgain.sso.start")!).nonce;
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });
});

describe("workspaceName", () => {
  it("takes what the API would, and drops what would fail its validation", () => {
    expect(workspaceName("  Northwind ")).toBe("northwind");
    expect(workspaceName("acme-corp")).toBe("acme-corp");
    // A company name autofilled into the field, a blank field, nothing at all.
    expect(workspaceName("Acme Corp")).toBeNull();
    expect(workspaceName("  ")).toBeNull();
    expect(workspaceName(undefined)).toBeNull();
  });
});

describe("dropForeignClerkClient", () => {
  const ORIGIN = "https://app.appsgain.test";
  let replaced: string[];

  function at(path: string) {
    replaced = [];
    (globalThis as { window?: unknown }).window = {
      sessionStorage: storage,
      location: { href: `${ORIGIN}${path}` },
      history: {
        state: { __NA: true },
        replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url),
      },
    };
  }

  it("takes a Clerk client handed over in a link out of the address", () => {
    at("/sign-in?__clerk_db_jwt=someone-elses&redirect=%2Fleads");
    expect(dropForeignClerkClient()).toBe(true);
    expect(replaced).toEqual([`${ORIGIN}/sign-in?redirect=%2Fleads`]);
  });

  it("does so on a return page too, when this tab started no flow", () => {
    at("/sign-in/sso-complete?__clerk_db_jwt=someone-elses");
    expect(dropForeignClerkClient()).toBe(true);
    expect(replaced).toEqual([`${ORIGIN}/sign-in/sso-complete`]);
  });

  it("leaves Clerk's own return from Google alone, mid-flow", () => {
    at("/sign-in/sso-callback?__clerk_db_jwt=this-tabs-own");
    rememberSsoStart({ provider: "google", origin: "/sign-in" });
    expect(dropForeignClerkClient()).toBe(false);
    expect(replaced).toEqual([]);
  });

  it("takes it out of any other page even mid-flow, and does nothing without it", () => {
    rememberSsoStart({ provider: "google", origin: "/sign-in" });
    at("/sign-up?__clerk_db_jwt=someone-elses");
    expect(dropForeignClerkClient()).toBe(true);

    at("/sign-in");
    expect(dropForeignClerkClient()).toBe(false);
    expect(replaced).toEqual([]);
  });
});

describe("ssoErrorMessage", () => {
  it("shows the API's own sentences for the answers written for people", () => {
    for (const status of [401, 409, 429, 503]) {
      expect(ssoErrorMessage(new ApiError(`message ${status}`, status))).toBe(`message ${status}`);
    }
  });

  it("does not show validation details or server internals", () => {
    expect(ssoErrorMessage(new ApiError("token must be a string", 400))).toMatch(
      /could not be completed/,
    );
    expect(ssoErrorMessage(new ApiError("Internal server error", 500))).toMatch(/on our side/);
    expect(ssoErrorMessage(new TypeError("Failed to fetch"))).toMatch(/Could not reach the server/);
  });
});

describe("providerLabel", () => {
  it("names the provider, or both when it is not known", () => {
    expect(providerLabel("google")).toBe("Google");
    expect(providerLabel("microsoft")).toBe("Microsoft");
    expect(providerLabel(null)).toBe("Google or Microsoft");
  });
});
