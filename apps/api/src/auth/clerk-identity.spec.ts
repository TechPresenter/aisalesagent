import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { ClerkBackendVerifier, clerkAuthorizedParties } from "./clerk-identity";

/**
 * The real `verifyToken` runs here — signature, expiry and `azp` are checked by Clerk's own
 * SDK — against tokens signed with a key made for the test and handed over as
 * CLERK_JWT_KEY, so nothing goes over the network. Only the calls to Clerk's API — the
 * user lookup, and the session check and revoke — are stubbed.
 */

const mockGetUser = jest.fn();
const mockGetSession = jest.fn();
const mockRevokeSession = jest.fn();
jest.mock("@clerk/backend", () => ({
  ...jest.requireActual("@clerk/backend"),
  createClerkClient: () => ({
    users: { getUser: mockGetUser },
    sessions: { getSession: mockGetSession, revokeSession: mockRevokeSession },
  }),
}));

const WEB = "https://app.appsgain.test";

function keyPair(): { privateKey: KeyObject; pem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, pem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

const clerkKey = keyPair();
const otherKey = keyPair();

function sessionToken(
  claims: Record<string, unknown> = {},
  privateKey = clerkKey.privateKey,
): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: "ins_test" })}.${encode({
    sub: "user_clerk_1",
    sid: "sess_1",
    iss: "https://example.clerk.accounts.dev",
    azp: WEB,
    iat: now - 5,
    nbf: now - 10,
    exp: now + 60,
    ...claims,
  })}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}

function clerkUser(email: { address: string; status: string; strategy: string } | null) {
  const primary = email
    ? {
        id: "idn_1",
        emailAddress: email.address,
        verification: { status: email.status, strategy: email.strategy },
        linkedTo: [],
      }
    : null;
  return { id: "user_clerk_1", fullName: " Priya Sharma ", primaryEmailAddress: primary };
}

function verifier(env: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    CLERK_SECRET_KEY: "sk_test_not_a_real_key",
    CLERK_JWT_KEY: clerkKey.pem,
    API_CORS_ORIGINS: `http://localhost:3001,${WEB}/`,
    ...env,
  };
  return new ClerkBackendVerifier({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
}

function clerkSession(status = "active", userId = "user_clerk_1") {
  return { id: "sess_1", userId, status };
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue(
    clerkUser({ address: "Priya@Example.com", status: "verified", strategy: "from_oauth_google" }),
  );
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(clerkSession());
  mockRevokeSession.mockReset();
  mockRevokeSession.mockResolvedValue(clerkSession("revoked"));
});

describe("clerkAuthorizedParties", () => {
  it("is the CORS origins plus WEB_APP_URL, as bare origins, once each", () => {
    expect(
      clerkAuthorizedParties({
        API_CORS_ORIGINS: " https://qa.appsgain.app/ , https://www.appsgain.app",
        WEB_APP_URL: "https://qa.appsgain.app",
      }),
    ).toEqual(["https://qa.appsgain.app", "https://www.appsgain.app"]);
  });

  it("falls back to the API's own CORS default and is never empty", () => {
    expect(clerkAuthorizedParties({})).toEqual(["http://localhost:3000"]);
    expect(clerkAuthorizedParties({ API_CORS_ORIGINS: " , " })).toEqual(["http://localhost:3000"]);
  });
});

describe("ClerkBackendVerifier", () => {
  it("is switched off without CLERK_SECRET_KEY", async () => {
    const off = verifier({ CLERK_SECRET_KEY: "  " });
    expect(off.enabled).toBe(false);
    await expect(off.identify(sessionToken())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(verifier().enabled).toBe(true);
  });

  it("reads the identity behind a valid token from an allowed origin, then ends its session", async () => {
    await expect(verifier().identify(sessionToken())).resolves.toEqual({
      userId: "user_clerk_1",
      primaryEmail: { address: "Priya@Example.com", verified: true },
      name: "Priya Sharma",
      provider: "google",
    });
    expect(mockGetUser).toHaveBeenCalledWith("user_clerk_1");
    expect(mockGetSession).toHaveBeenCalledWith("sess_1");
    // Revoked on Clerk's side, whatever the browser does next: the hand-off is single-use.
    expect(mockRevokeSession).toHaveBeenCalledWith("sess_1");
  });

  it.each([
    ["has already ended (signed out, or traded here once)", clerkSession("revoked")],
    ["belongs to somebody else", clerkSession("active", "user_clerk_2")],
  ])("refuses a valid token whose session %s, and revokes nothing", async (_label, session) => {
    mockGetSession.mockResolvedValue(session);
    await expect(verifier().identify(sessionToken())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockRevokeSession).not.toHaveBeenCalled();
  });

  it("refuses the sign-in when Clerk will not revoke the session", async () => {
    mockRevokeSession.mockRejectedValue(
      new ClerkAPIResponseError("Bad Request", { data: [], status: 400 }),
    );
    await expect(verifier().identify(sessionToken())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("takes a CLERK_JWT_KEY pasted onto one line with literal \\n", async () => {
    const oneLine = verifier({ CLERK_JWT_KEY: clerkKey.pem.trim().replace(/\n/g, "\\n") });
    await expect(oneLine.identify(sessionToken())).resolves.toMatchObject({
      userId: "user_clerk_1",
    });
  });

  it("reports an unverified primary address as unverified, for the caller to refuse", async () => {
    mockGetUser.mockResolvedValue(
      clerkUser({
        address: "ceo@victim.com",
        status: "unverified",
        strategy: "from_oauth_microsoft",
      }),
    );
    await expect(verifier().identify(sessionToken())).resolves.toMatchObject({
      primaryEmail: { address: "ceo@victim.com", verified: false },
      provider: "microsoft",
    });
  });

  it.each([
    ["minted for another origin", sessionToken({ azp: "https://evil.example" })],
    ["carrying no origin at all", sessionToken({ azp: undefined })],
    ["expired", sessionToken({ iat: 1_000, nbf: 1_000, exp: 2_000 })],
    ["signed by some other key", sessionToken({}, otherKey.privateKey)],
    [
      "opened by impersonation from the Clerk dashboard",
      sessionToken({ act: { sub: "user_admin" } }),
    ],
    ["for a session with steps left to finish", sessionToken({ sts: "pending" })],
    ["naming no session", sessionToken({ sid: undefined })],
    ["not a token", "not-a-token"],
  ])("refuses a token %s, without asking Clerk who it is", async (_label, token) => {
    await expect(verifier().identify(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("refuses a valid token whose user Clerk has since deleted", async () => {
    mockGetUser.mockRejectedValue(
      new ClerkAPIResponseError("Not Found", { data: [], status: 404 }),
    );
    await expect(verifier().identify(sessionToken())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("answers 503, not 401, when Clerk refuses our key or cannot be reached", async () => {
    mockGetUser.mockRejectedValueOnce(
      new ClerkAPIResponseError("Unauthorized", { data: [], status: 401 }),
    );
    await expect(verifier().identify(sessionToken())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    mockRevokeSession.mockRejectedValueOnce(
      new ClerkAPIResponseError("Too Many Requests", { data: [], status: 429 }),
    );
    await expect(verifier().identify(sessionToken())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    mockGetUser.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(verifier().identify(sessionToken())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
