import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import type {
  SsoKnownAddress,
  SsoSignInResult,
  SsoSignedIn,
  SsoSignupOffer,
  SsoUnconfirmedAccount,
  SsoWorkspaceChoice,
} from "@appsgain/shared";
import { maskAddress } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { AttemptLimiter } from "./attempt-limiter";
import { AuthService, type SessionContext } from "./auth.service";
import { ClerkIdentityVerifier, SSO_NOT_CONFIGURED, type ClerkIdentity } from "./clerk-identity";
import { signPurposeToken, verifyPurposeToken } from "./purpose-token";
import { TwoFactorService } from "./two-factor.service";

/** Long enough to fill in the company details on the sign-up form. */
const SIGNUP_TOKEN_MS = 15 * 60_000;
/** Long enough to pick a workspace from a list. */
const SELECTION_TOKEN_MS = 5 * 60_000;

/** An account the verified address can open, with what the sign-in needs of its workspace. */
type Account = User & { tenant: { name: string; subdomain: string } };

/** Who a signup token was issued to, as `POST /workspace` needs it. */
export interface SsoSignup {
  email: string;
  name: string | null;
  clerkUserId: string;
}

/**
 * Clerk's test mode, on by default in a development instance, treats any address with
 * "+clerk_test" in it as verified without sending anything. Such an address proves nothing
 * about who is signing in, whatever Clerk says about it.
 */
function isClerkTestAddress(email: string): boolean {
  return email.split("@")[0].includes("+clerk_test");
}

/**
 * "Continue with Google" and "Continue with Microsoft", with Clerk as the identity broker.
 *
 * Clerk proves one thing — that the person controls a verified email address — and
 * nothing more. Everything after that is Appsgain's own: which workspaces that address
 * belongs to, lockout, 2FA, and the session, which is the same pair of tokens a password
 * sign-in gets. No Clerk session outlives the hand-off: the verifier revokes it as it
 * reads it, and the web app signs out of Clerk as soon as this answers.
 *
 * Unscoped, like password sign-in: there is no tenant to scope to until the address has
 * been matched to one. Unlike password sign-in it may list the address's workspaces, but
 * only to the person who has just proved they own the address.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  /**
   * Per network address, across both routes. Each sign-in is a round trip to Clerk and an
   * Argon2 hash for the session, so this stops a flood — while staying well clear of an
   * office full of people signing in at nine from one shared address.
   */
  private readonly attempts = new AttemptLimiter(30, 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly clerk: ClerkIdentityVerifier,
  ) {}

  /** POST /auth/sso/clerk — a Clerk session token in; a session, a choice, or a signup out. */
  async signInWithClerk(
    input: { token: string; subdomain?: string },
    context: SessionContext = {},
  ): Promise<SsoSignInResult> {
    this.requireEnabled();
    this.throttle(context);

    const identity = await this.clerk.identify(input.token);

    // Only a verified primary address counts. Microsoft in particular can hand over an
    // address nobody ever verified — an Entra ID admin can put any address on an account
    // ("nOAuth") — and trusting that would let anyone sign in as anyone else.
    if (!identity.primaryEmail?.verified) {
      this.logger.warn(
        `SSO refused: Clerk user ${identity.userId} (${identity.provider ?? "unknown provider"}) has no verified primary email`,
      );
      throw new UnauthorizedException(
        "That Google or Microsoft account has no verified email address, so it cannot be used to sign in. Sign in with your email and password instead.",
      );
    }
    const email = identity.primaryEmail.address.trim().toLowerCase();
    if (isClerkTestAddress(email)) {
      this.logger.warn(`SSO refused: Clerk user ${identity.userId} has a Clerk test address`);
      throw new UnauthorizedException(
        "That is a Clerk test address, which cannot be used to sign in here.",
      );
    }
    const accounts = await this.accountsFor(email);

    if (accounts.length === 0) {
      this.logger.log(`SSO found no account for ${maskAddress(email)}: offering signup`);
      return {
        status: "signup-required",
        ...this.signupOffer(email, identity),
        ...(await this.knownAddress(email)),
      };
    }

    // A named workspace wins when the address belongs to it. A workspace the address does
    // not belong to is not quietly swapped for one it does: the person is shown where they
    // can go instead of landing somewhere they did not ask for.
    const chosen = input.subdomain
      ? accounts.find((account) => account.tenant.subdomain === input.subdomain)
      : accounts.length === 1
        ? accounts[0]
        : undefined;
    // An account that never confirmed its email is never opened without asking: whoever
    // set it up may have used this address without owning it, and may still hold the
    // workspace's keys, webhooks and co-admins. The person sees that, and picks.
    if (chosen?.emailVerifiedAt) return this.signIn(chosen, identity.provider, context);

    return this.workspaceChoice(email, identity, accounts);
  }

  /** POST /auth/sso/select — finishes a sign-in that ended in a choice of workspace. */
  async selectWorkspace(
    input: { selectionToken: string; subdomain: string },
    context: SessionContext = {},
  ): Promise<SsoSignedIn> {
    this.requireEnabled();
    this.throttle(context);

    const claims = verifyPurposeToken(this.secret(), "sso-select", input.selectionToken);
    if (!claims?.email) {
      throw new UnauthorizedException(
        "This sign-in has expired. Continue with Google or Microsoft again.",
      );
    }

    // Re-read rather than trusted from the token: an account disabled, or a workspace
    // cancelled, in the minutes since the list was shown is not on the list any more.
    const account = (await this.accountsFor(claims.email)).find(
      (candidate) => candidate.tenant.subdomain === input.subdomain,
    );
    if (!account) {
      throw new UnauthorizedException("You do not have an active account in that workspace.");
    }
    return this.signIn(account, claims.provider || null, context);
  }

  /**
   * For `POST /workspace` with an `ssoToken`: who the token was issued to. The token is
   * the proof of the address, so the workspace's owner starts with it verified.
   *
   * The token itself is good for fifteen minutes, but it is single-use in practice: once
   * the address has a confirmed account — the one the first use created, say — it is
   * refused, and the person signs in instead.
   */
  async claimSignupToken(token: string): Promise<SsoSignup> {
    this.requireEnabled();
    const claims = verifyPurposeToken(this.secret(), "sso-signup", token);
    if (!claims?.email || !claims.clerkUser) {
      throw new BadRequestException(
        "This Google or Microsoft sign-up has expired. Continue with Google or Microsoft again.",
      );
    }
    if ((await this.accountsFor(claims.email)).some((account) => account.emailVerifiedAt)) {
      throw new ConflictException(
        "An Appsgain account already uses this address. Sign in with Google or Microsoft instead.",
      );
    }
    return { email: claims.email, name: claims.name || null, clerkUserId: claims.clerkUser };
  }

  /**
   * Signs in an account the verified address matched, by the same rules as a password.
   *
   * An account whose email was never confirmed is only ever reached here by being picked
   * from a choice that said so, and it is taken over first (see takeOver).
   */
  private async signIn(
    account: Account,
    provider: string | null,
    context: SessionContext,
  ): Promise<SsoSignedIn> {
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      throw new UnauthorizedException("Too many attempts. Wait 15 minutes, then sign in again.");
    }

    const passwordCleared = !account.emailVerifiedAt;
    const user = passwordCleared ? await this.takeOver(account) : account;
    const notice = passwordCleared ? { passwordCleared: true as const } : {};

    // Google or Microsoft stands in for the password, never for the second factor. The
    // challenge is the one password sign-in issues, finished at `POST /auth/login/2fa`.
    if (await this.twoFactor.isEnabled(user.id)) {
      return { ...this.auth.twoFactorChallenge(user), ...notice };
    }

    const session = await this.auth.completeSignIn(user, account.tenant.name, context);
    this.logger.log(
      `SSO sign-in (${provider ?? "unknown provider"}): user=${user.id} tenant=${user.tenantId}`,
    );
    return { ...session, ...notice };
  }

  /**
   * Anyone can sign up with someone else's address and set a password, then wait for the
   * real owner to arrive ("pre-hijacking"). The owner has just proved the address is
   * theirs, so nothing set up before that proof is trusted: the address is marked
   * verified, the password is replaced by one nobody knows, the two-factor enrolment (a
   * challenge the owner could not pass) is removed and every session is ended — in one
   * transaction, so no half-taken account is ever left behind.
   *
   * What the creator set up in the workspace itself — members, invitations, API keys,
   * webhooks — stays: the owner may be the one who set them up. The choice that led here
   * counted them, and the page that follows says where to review them.
   */
  private async takeOver(account: Account): Promise<User> {
    const now = new Date();
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: account.id },
        data: {
          emailVerifiedAt: now,
          passwordHash: await AuthService.unusablePasswordHash(),
          hasPassword: false,
        },
      }),
      this.prisma.twoFactorAuth.deleteMany({ where: { userId: account.id } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: account.id, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    this.logger.warn(
      `SSO took over a never-verified account: password, 2FA and sessions cleared for user=${account.id} tenant=${account.tenantId}`,
    );
    return user;
  }

  private async workspaceChoice(
    email: string,
    identity: ClerkIdentity,
    accounts: Account[],
  ): Promise<SsoWorkspaceChoice> {
    const workspaces = await Promise.all(
      accounts.map(async (account) => ({
        subdomain: account.tenant.subdomain,
        name: account.tenant.name,
        ...(account.emailVerifiedAt ? {} : { unconfirmed: await this.unconfirmed(account) }),
      })),
    );
    // With only never-confirmed accounts to go to, none of them may be the person's own.
    const noneConfirmed = accounts.every((account) => !account.emailVerifiedAt);

    return {
      status: "choose-workspace",
      selectionToken: signPurposeToken(
        this.secret(),
        "sso-select",
        { email, clerkUser: identity.userId, provider: identity.provider ?? "" },
        SELECTION_TOKEN_MS,
      ),
      workspaces,
      expiresIn: SELECTION_TOKEN_MS / 1000,
      ...(noneConfirmed ? { signup: this.signupOffer(email, identity) } : {}),
    };
  }

  /** What whoever created a never-confirmed account may still control in its workspace. */
  private async unconfirmed(account: Account): Promise<SsoUnconfirmedAccount> {
    const tenantId = account.tenantId;
    const now = new Date();
    const [otherMembers, pendingInvitations, apiKeys, webhooks] = await Promise.all([
      this.prisma.user.count({
        where: { tenantId, id: { not: account.id }, status: { not: "DISABLED" } },
      }),
      this.prisma.invitation.count({
        where: { tenantId, status: "PENDING", revokedAt: null, expiresAt: { gt: now } },
      }),
      this.prisma.apiKey.count({
        where: { tenantId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      }),
      this.prisma.webhook.count({ where: { tenantId, isActive: true } }),
    ]);
    return {
      createdAt: account.createdAt.toISOString(),
      otherMembers,
      pendingInvitations,
      apiKeys,
      webhooks,
    };
  }

  private signupOffer(email: string, identity: ClerkIdentity): SsoSignupOffer {
    return {
      signupToken: signPurposeToken(
        this.secret(),
        "sso-signup",
        { email, clerkUser: identity.userId, name: identity.name ?? "" },
        SIGNUP_TOKEN_MS,
      ),
      email,
      name: identity.name,
      expiresIn: SIGNUP_TOKEN_MS / 1000,
    };
  }

  /**
   * Where an address with no account to sign in to is known all the same, so the sign-up
   * page can say so instead of quietly starting a second workspace: an account turned off
   * by an admin, or an invitation not yet accepted. The person has proved they own the
   * address, so naming the workspace tells nobody anything new.
   */
  private async knownAddress(email: string): Promise<{ known?: SsoKnownAddress }> {
    const disabled = await this.prisma.user.findFirst({
      where: { email, status: "DISABLED", tenant: { status: { not: "CANCELLED" } } },
      select: { tenant: { select: { name: true } } },
    });
    if (disabled) return { known: { reason: "disabled", workspace: disabled.tenant.name } };

    const invitation = await this.prisma.invitation.findFirst({
      where: {
        email,
        status: "PENDING",
        revokedAt: null,
        expiresAt: { gt: new Date() },
        tenant: { status: { notIn: ["CANCELLED", "SUSPENDED"] } },
      },
      select: { tenant: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return invitation ? { known: { reason: "invited", workspace: invitation.tenant.name } } : {};
  }

  /**
   * Every account this address can sign in to: active, in a workspace that has not been
   * cancelled. Email is unique per workspace, not globally, so there may be several.
   */
  private accountsFor(email: string): Promise<Account[]> {
    return this.prisma.user.findMany({
      where: { email, status: "ACTIVE", tenant: { status: { not: "CANCELLED" } } },
      include: { tenant: { select: { name: true, subdomain: true } } },
      orderBy: { tenant: { name: "asc" } },
      take: 50,
    });
  }

  private throttle(context: SessionContext): void {
    if (!this.attempts.hit(context.ipAddress ?? "unknown")) {
      throw new HttpException(
        "Too many sign-in attempts from this network. Wait a minute, then try again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Off, not open: without CLERK_SECRET_KEY no Clerk token could be checked. */
  private requireEnabled(): void {
    if (!this.clerk.enabled) throw new ServiceUnavailableException(SSO_NOT_CONFIGURED);
  }

  private secret(): string {
    return this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
  }
}
