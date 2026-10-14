import {
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import type { User } from "@prisma/client";
import type { LoginResponse, SsoSignupRequired, SsoWorkspaceChoice } from "@appsgain/shared";
import type { MailService } from "../mail/mail.service";
import type { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import type { ClerkIdentity, ClerkIdentityVerifier } from "./clerk-identity";
import { passwordFingerprint, signPurposeToken, verifyPurposeToken } from "./purpose-token";
import { SsoService } from "./sso.service";
import type { TwoFactorService } from "./two-factor.service";

/**
 * Google and Microsoft sign-in turns "Clerk vouches for this address" into an Appsgain
 * session, so what matters is everything it must refuse — an address Clerk has not
 * verified, a paused account, a skipped second factor — and that an account nobody ever
 * confirmed is never opened without asking, and is taken back from whoever set it up when
 * it is. Clerk itself is a stub here.
 */

const SECRET = "test-access-secret-with-enough-length-0123456789";
const ORIGINAL_HASH = "$argon2id$v=19$m=65536,t=3,p=4$original-hash-set-at-signup";

type Account = User & { tenant: { name: string; subdomain: string } };

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "user-acme",
    tenantId: "tenant-acme",
    email: "priya@example.com",
    name: "Priya Sharma",
    passwordHash: ORIGINAL_HASH,
    hasPassword: true,
    role: "OWNER",
    customRoleId: null,
    status: "ACTIVE",
    phone: null,
    avatarUrl: null,
    language: "en",
    emailVerifiedAt: new Date("2026-09-01T00:00:00Z"),
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    tenant: { name: "Acme", subdomain: "acme" },
    ...overrides,
  };
}

const beta = () =>
  account({
    id: "user-beta",
    tenantId: "tenant-beta",
    tenant: { name: "Beta", subdomain: "beta" },
  });

/** A self-signup that never confirmed its email. */
const unconfirmed = (overrides: Partial<Account> = {}) =>
  account({ emailVerifiedAt: null, createdAt: new Date("2026-10-01T09:00:00Z"), ...overrides });

function setup(
  options: {
    enabled?: boolean;
    identity?: Partial<ClerkIdentity>;
    accounts?: Account[];
    twoFactor?: boolean;
    disabledIn?: string;
    invitedTo?: string;
  } = {},
) {
  const identity: ClerkIdentity = {
    userId: "user_clerk_1",
    primaryEmail: { address: "Priya@Example.com", verified: true },
    name: "Priya Sharma",
    provider: "google",
    ...options.identity,
  };
  const accounts = options.accounts ?? [account()];

  const identify = jest.fn().mockResolvedValue(identity);
  const verifier = {
    enabled: options.enabled ?? true,
    identify,
  } as unknown as ClerkIdentityVerifier;

  // Enrolled until the takeover deletes the enrolment, as the database would have it.
  let enrolled = options.twoFactor ?? false;

  const findMany = jest.fn().mockResolvedValue(accounts);
  const update = jest.fn(
    async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
      const { tenant: _tenant, ...row } = accounts.find((candidate) => candidate.id === where.id)!;
      return { ...row, ...data };
    },
  );
  const deleteTwoFactor = jest.fn(async () => {
    enrolled = false;
    return { count: 1 };
  });
  const revokeSessions = jest.fn().mockResolvedValue({ count: 2 });
  const transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));
  const findDisabled = jest
    .fn()
    .mockResolvedValue(options.disabledIn ? { tenant: { name: options.disabledIn } } : null);
  const findInvitation = jest
    .fn()
    .mockResolvedValue(options.invitedTo ? { tenant: { name: options.invitedTo } } : null);
  const prisma = {
    user: { findMany, update, findFirst: findDisabled, count: jest.fn().mockResolvedValue(2) },
    invitation: { findFirst: findInvitation, count: jest.fn().mockResolvedValue(1) },
    apiKey: { count: jest.fn().mockResolvedValue(3) },
    webhook: { count: jest.fn().mockResolvedValue(1) },
    twoFactorAuth: { deleteMany: deleteTwoFactor },
    refreshToken: { updateMany: revokeSessions },
    $transaction: transaction,
  } as unknown as PrismaService;

  const config = {
    getOrThrow: () => SECRET,
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService;
  const twoFactor = {
    isEnabled: jest.fn(async () => enrolled),
  } as unknown as TwoFactorService;

  // The real AuthService, so the 2FA challenge is the one password sign-in issues; only
  // the parts that write sessions are replaced.
  const auth = new AuthService(prisma, {} as JwtService, config, twoFactor, {} as MailService);
  const session = {
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 900,
  } as LoginResponse;
  const completeSignIn = jest.spyOn(auth, "completeSignIn").mockResolvedValue(session);
  const revokeAllSessions = jest.spyOn(auth, "revokeAllSessions").mockResolvedValue();

  const sso = new SsoService(prisma, config, auth, twoFactor, verifier);
  return {
    sso,
    identify,
    findMany,
    update,
    deleteTwoFactor,
    revokeSessions,
    transaction,
    completeSignIn,
    revokeAllSessions,
  };
}

const context = { ipAddress: "203.0.113.7", userAgent: "jest" };

describe("SsoService.signInWithClerk", () => {
  it("is off, not open, when CLERK_SECRET_KEY is missing", async () => {
    const { sso, identify } = setup({ enabled: false });
    await expect(sso.signInWithClerk({ token: "t" }, context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(
      sso.selectWorkspace({ selectionToken: "t", subdomain: "acme" }, context),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(sso.claimSignupToken("t")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(identify).not.toHaveBeenCalled();
  });

  it("passes on Clerk refusing the token, and looks nobody up", async () => {
    const { sso, identify, findMany } = setup();
    identify.mockRejectedValueOnce(new UnauthorizedException("not confirmed"));
    await expect(sso.signInWithClerk({ token: "forged" }, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("refuses an address Clerk has not verified — the Microsoft nOAuth case", async () => {
    const { sso, findMany, completeSignIn } = setup({
      identity: {
        provider: "microsoft",
        primaryEmail: { address: "ceo@victim.com", verified: false },
      },
    });
    await expect(sso.signInWithClerk({ token: "t" }, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("refuses a Clerk test address, which test mode verifies without sending anything", async () => {
    const { sso, findMany } = setup({
      identity: { primaryEmail: { address: "priya+clerk_test@example.com", verified: true } },
    });
    await expect(sso.signInWithClerk({ token: "t" }, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("refuses a Clerk user with no primary address at all", async () => {
    const { sso, findMany } = setup({ identity: { primaryEmail: null } });
    await expect(sso.signInWithClerk({ token: "t" }, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("looks the address up lowercased, across workspaces, active accounts only", async () => {
    const { sso, findMany } = setup();
    await sso.signInWithClerk({ token: "t" }, context);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: "priya@example.com",
          status: "ACTIVE",
          tenant: { status: { not: "CANCELLED" } },
        },
      }),
    );
  });

  it("offers signup, with a token for that address only, when no account uses it", async () => {
    const { sso, completeSignIn } = setup({ accounts: [] });
    const result = (await sso.signInWithClerk({ token: "t" }, context)) as SsoSignupRequired;

    expect(result).toMatchObject({
      status: "signup-required",
      email: "priya@example.com",
      name: "Priya Sharma",
      expiresIn: 900,
    });
    expect(result).not.toHaveProperty("known");
    await expect(sso.claimSignupToken(result.signupToken)).resolves.toEqual({
      email: "priya@example.com",
      name: "Priya Sharma",
      clerkUserId: "user_clerk_1",
    });
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("says where else the address is known: an account turned off, or an invitation", async () => {
    const disabled = await setup({ accounts: [], disabledIn: "Acme" }).sso.signInWithClerk(
      { token: "t" },
      context,
    );
    expect(disabled).toMatchObject({
      status: "signup-required",
      known: { reason: "disabled", workspace: "Acme" },
    });

    const invited = await setup({ accounts: [], invitedTo: "Beta" }).sso.signInWithClerk(
      { token: "t" },
      context,
    );
    expect(invited).toMatchObject({
      status: "signup-required",
      known: { reason: "invited", workspace: "Beta" },
    });
  });

  it("signs in the one account the address has", async () => {
    const { sso, completeSignIn } = setup();
    const result = await sso.signInWithClerk({ token: "t" }, context);

    expect(completeSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-acme" }),
      "Acme",
      context,
    );
    expect(result).toMatchObject({ accessToken: "access", refreshToken: "refresh" });
    expect(result).not.toHaveProperty("passwordCleared");
  });

  it("lists the workspaces when there are several, and signs nobody in", async () => {
    const { sso, completeSignIn } = setup({ accounts: [account(), beta()] });
    const result = (await sso.signInWithClerk({ token: "t" }, context)) as SsoWorkspaceChoice;

    expect(result.status).toBe("choose-workspace");
    expect(result.workspaces).toEqual([
      { subdomain: "acme", name: "Acme" },
      { subdomain: "beta", name: "Beta" },
    ]);
    expect(verifyPurposeToken(SECRET, "sso-select", result.selectionToken)).toMatchObject({
      email: "priya@example.com",
      clerkUser: "user_clerk_1",
    });
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("goes straight to the workspace the page named, when the address belongs to it", async () => {
    const { sso, completeSignIn } = setup({ accounts: [account(), beta()] });
    await sso.signInWithClerk({ token: "t", subdomain: "beta" }, context);
    expect(completeSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-beta" }),
      "Beta",
      context,
    );
  });

  it("does not swap a named workspace it does not belong to for one it does", async () => {
    const { sso, completeSignIn } = setup();
    const result = await sso.signInWithClerk({ token: "t", subdomain: "gamma" }, context);
    expect(result).toMatchObject({
      status: "choose-workspace",
      workspaces: [{ subdomain: "acme", name: "Acme" }],
    });
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("honours a sign-in pause from earlier wrong passwords", async () => {
    const { sso, completeSignIn } = setup({
      accounts: [account({ lockedUntil: new Date(Date.now() + 60_000) })],
    });
    await expect(sso.signInWithClerk({ token: "t" }, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("never opens a never-verified account without asking, even the only one", async () => {
    const { sso, update, completeSignIn } = setup({ accounts: [unconfirmed()] });
    const result = (await sso.signInWithClerk({ token: "t" }, context)) as SsoWorkspaceChoice;

    expect(result.status).toBe("choose-workspace");
    expect(result.workspaces).toEqual([
      {
        subdomain: "acme",
        name: "Acme",
        unconfirmed: {
          createdAt: "2026-10-01T09:00:00.000Z",
          otherMembers: 2,
          pendingInvitations: 1,
          apiKeys: 3,
          webhooks: 1,
        },
      },
    ]);
    // None of the workspaces may be theirs, so they may make their own instead.
    expect(result.signup).toMatchObject({ email: "priya@example.com", name: "Priya Sharma" });
    await expect(sso.claimSignupToken(result.signup!.signupToken)).resolves.toMatchObject({
      email: "priya@example.com",
    });
    expect(update).not.toHaveBeenCalled();
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("asks about a never-verified account even when the page named its workspace", async () => {
    const { sso, completeSignIn } = setup({ accounts: [unconfirmed()] });
    const result = await sso.signInWithClerk({ token: "t", subdomain: "acme" }, context);
    expect(result).toMatchObject({ status: "choose-workspace" });
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("flags only the never-verified one beside a confirmed account, and offers no signup", async () => {
    const { sso } = setup({
      accounts: [account(), unconfirmed({ ...beta(), emailVerifiedAt: null })],
    });
    const result = (await sso.signInWithClerk({ token: "t" }, context)) as SsoWorkspaceChoice;

    expect(result.workspaces[0]).toEqual({ subdomain: "acme", name: "Acme" });
    expect(result.workspaces[1]).toMatchObject({ subdomain: "beta", unconfirmed: { apiKeys: 3 } });
    expect(result).not.toHaveProperty("signup");
  });

  it("leaves a verified account's password, 2FA and sessions alone", async () => {
    const { sso, update, transaction, revokeAllSessions } = setup();
    await sso.signInWithClerk({ token: "t" }, context);
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });

  it("never skips two-factor: the answer is password sign-in's own challenge", async () => {
    const { sso, completeSignIn } = setup({ twoFactor: true });
    const result = await sso.signInWithClerk({ token: "t" }, context);

    expect(result).toMatchObject({ twoFactorRequired: true, expiresIn: 300 });
    const challenge = (result as { challengeToken: string }).challengeToken;
    expect(verifyPurposeToken(SECRET, "login-2fa", challenge)).toMatchObject({
      u: "user-acme",
      t: "tenant-acme",
      f: passwordFingerprint(ORIGINAL_HASH),
    });
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("slows a flood from one address without touching another", async () => {
    const { sso } = setup({ accounts: [] });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sso.signInWithClerk({ token: "t" }, context);
    }
    const refused = await sso
      .signInWithClerk({ token: "t" }, context)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);

    await expect(
      sso.signInWithClerk({ token: "t" }, { ...context, ipAddress: "198.51.100.1" }),
    ).resolves.toMatchObject({ status: "signup-required" });
  });
});

describe("SsoService.selectWorkspace", () => {
  async function choice(sso: SsoService): Promise<string> {
    const result = (await sso.signInWithClerk({ token: "t" }, context)) as SsoWorkspaceChoice;
    return result.selectionToken;
  }

  it("signs in to the workspace picked from the list", async () => {
    const { sso, completeSignIn } = setup({ accounts: [account(), beta()] });
    const selectionToken = await choice(sso);

    await sso.selectWorkspace({ selectionToken, subdomain: "beta" }, context);
    expect(completeSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-beta" }),
      "Beta",
      context,
    );
  });

  it("refuses a workspace the address has no active account in", async () => {
    const { sso, completeSignIn } = setup({ accounts: [account(), beta()] });
    const selectionToken = await choice(sso);

    await expect(
      sso.selectWorkspace({ selectionToken, subdomain: "gamma" }, context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("refuses an expired, forged or wrong-purpose token", async () => {
    const { sso } = setup({ accounts: [account(), beta()] });
    const claims = { email: "priya@example.com", clerkUser: "user_clerk_1" };
    const expired = signPurposeToken(SECRET, "sso-select", claims, 60_000, Date.now() - 120_000);
    const signup = signPurposeToken(SECRET, "sso-signup", claims, 60_000);
    const forged = signPurposeToken(`${SECRET}x`, "sso-select", claims, 60_000);

    for (const selectionToken of [expired, signup, forged, "not-a-token"]) {
      await expect(
        sso.selectWorkspace({ selectionToken, subdomain: "acme" }, context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it("takes a picked never-verified account back from whoever set it up", async () => {
    const { sso, update, deleteTwoFactor, revokeSessions, transaction, completeSignIn } = setup({
      accounts: [unconfirmed()],
    });
    const selectionToken = await choice(sso);
    const result = await sso.selectWorkspace({ selectionToken, subdomain: "acme" }, context);

    const data = update.mock.calls[0][0].data;
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data.hasPassword).toBe(false);
    expect(data.passwordHash).toMatch(/^\$argon2id\$/);
    expect(data.passwordHash).not.toBe(ORIGINAL_HASH);
    expect(deleteTwoFactor).toHaveBeenCalledWith({ where: { userId: "user-acme" } });
    expect(revokeSessions).toHaveBeenCalledWith({
      where: { userId: "user-acme", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // All three in one transaction, and before the new session exists, so it survives.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(3);
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      completeSignIn.mock.invocationCallOrder[0],
    );
    expect(completeSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: data.passwordHash, hasPassword: false }),
      "Acme",
      context,
    );
    expect(result).toMatchObject({ accessToken: "access", passwordCleared: true });
  });

  it("does not trust a 2FA enrolment made before the address was proved", async () => {
    const { sso, completeSignIn } = setup({ twoFactor: true, accounts: [unconfirmed()] });
    const selectionToken = await choice(sso);
    const result = await sso.selectWorkspace({ selectionToken, subdomain: "acme" }, context);

    // The creator's authenticator would otherwise stand between the owner and the account.
    expect(result).not.toHaveProperty("twoFactorRequired");
    expect(result).toMatchObject({ accessToken: "access", passwordCleared: true });
    expect(completeSignIn).toHaveBeenCalled();
  });

  it("still asks a confirmed account picked from the list for its second factor", async () => {
    const { sso, completeSignIn } = setup({ twoFactor: true, accounts: [account(), beta()] });
    const selectionToken = await choice(sso);
    const result = await sso.selectWorkspace({ selectionToken, subdomain: "beta" }, context);

    expect(result).toMatchObject({ twoFactorRequired: true });
    expect(result).not.toHaveProperty("passwordCleared");
    expect(completeSignIn).not.toHaveBeenCalled();
  });
});

describe("SsoService.claimSignupToken", () => {
  const claims = { email: "priya@example.com", clerkUser: "user_clerk_1", name: "" };

  it("refuses an expired, forged or wrong-purpose token", async () => {
    const { sso } = setup({ accounts: [] });
    const expired = signPurposeToken(SECRET, "sso-signup", claims, 60_000, Date.now() - 120_000);
    const selection = signPurposeToken(SECRET, "sso-select", claims, 60_000);
    const forged = signPurposeToken(`${SECRET}x`, "sso-signup", claims, 60_000);

    for (const token of [expired, selection, forged, "not-a-token"]) {
      await expect(sso.claimSignupToken(token)).rejects.toThrow(/expired/);
    }
  });

  it("reports a missing name as null rather than an empty string", async () => {
    const { sso } = setup({ accounts: [] });
    const token = signPurposeToken(SECRET, "sso-signup", claims, 60_000);
    expect((await sso.claimSignupToken(token)).name).toBeNull();
  });

  it("is spent once the address has a confirmed account, such as the one it created", async () => {
    const token = signPurposeToken(SECRET, "sso-signup", claims, 60_000);
    await expect(setup().sso.claimSignupToken(token)).rejects.toBeInstanceOf(ConflictException);
    // Never-confirmed accounts are someone else's doing, and do not use the token up.
    await expect(
      setup({ accounts: [unconfirmed()] }).sso.claimSignupToken(token),
    ).resolves.toMatchObject({ email: "priya@example.com" });
  });
});
