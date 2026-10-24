import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createClerkClient,
  verifyToken,
  type ClerkClient,
  type EmailAddress,
} from "@clerk/backend";
import {
  TokenVerificationErrorReason,
  isClerkAPIResponseError,
  type ClerkAPIResponseError,
} from "@clerk/backend/errors";

/**
 * What Clerk says about the person behind a session token. Facts only — whether they are
 * enough to open an Appsgain account is SsoService's decision, not this file's.
 */
export interface ClerkIdentity {
  /** Clerk's id for the person (`user_…`). */
  userId: string;
  /** The primary address as Clerk holds it, and whether Clerk has verified it. */
  primaryEmail: { address: string; verified: boolean } | null;
  name: string | null;
  /** How the primary address was verified — "google", "microsoft", "email_code"… For logs. */
  provider: string | null;
}

/**
 * The seam between sign-in and Clerk. Everything that talks to Clerk sits behind this, so
 * the tests can put a stub here and exercise every branch of SsoService without a network.
 */
export abstract class ClerkIdentityVerifier {
  /** False when CLERK_SECRET_KEY is not set, which switches Google and Microsoft sign-in off. */
  abstract get enabled(): boolean;

  /**
   * The identity behind a Clerk session token, after which that Clerk session is over:
   * each one can be traded for an Appsgain answer once. Throws UnauthorizedException for a
   * token Clerk did not issue to this app or a session that has already ended, and
   * ServiceUnavailableException when Clerk cannot be asked.
   */
  abstract identify(sessionToken: string): Promise<ClerkIdentity>;
}

export const SSO_NOT_CONFIGURED =
  "Google and Microsoft sign-in is not set up on this server. Sign in with your email and password.";
const SSO_UNAVAILABLE =
  "Google and Microsoft sign-in is not available right now. Try again in a minute, or sign in with your email and password.";
const SSO_REJECTED = "Your Google or Microsoft sign-in could not be confirmed. Try again.";

/**
 * Origins whose Clerk session tokens are accepted: the web app's, which are the API's
 * CORS origins plus WEB_APP_URL. Clerk writes the origin a token was minted for into its
 * `azp` claim, so a token obtained by some other site that embeds the same Clerk instance
 * is refused even though Clerk signed it. Never empty — an empty list switches Clerk's
 * check off.
 */
export function clerkAuthorizedParties(env: {
  API_CORS_ORIGINS?: string;
  WEB_APP_URL?: string;
}): string[] {
  const candidates = [
    ...(env.API_CORS_ORIGINS ?? "http://localhost:3000").split(","),
    env.WEB_APP_URL ?? "",
  ];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Not a URL — main.ts would hand it to CORS as it is, so compare it as it is too.
      origins.add(trimmed.replace(/\/+$/, ""));
    }
  }
  return origins.size > 0 ? [...origins] : ["http://localhost:3000"];
}

const TOKEN_ERROR_REASONS = new Set<string>(Object.values(TokenVerificationErrorReason));

/**
 * The reason code when `error` is the SDK's TokenVerificationError. Not `instanceof`: the
 * SDK's main entry and its /errors entry each carry their own copy of the class, so the
 * one `verifyToken` throws is never an instance of the one importable here.
 */
function tokenErrorReason(error: unknown): string | null {
  const reason =
    error instanceof Error ? (error as Error & { reason?: unknown }).reason : undefined;
  return typeof reason === "string" && TOKEN_ERROR_REASONS.has(reason) ? reason : null;
}

/** "from_oauth_google" or a link of type "oauth_microsoft" → "google" / "microsoft". */
function providerOf(email: EmailAddress | null): string | null {
  const source = email?.verification?.strategy || email?.linkedTo[0]?.type || null;
  return source ? source.replace(/^(from_)?oauth_/, "") : null;
}

/**
 * The real verifier, on Clerk's official backend SDK.
 *
 * The token's signature, expiry and `azp` are checked by `verifyToken` — networkless with
 * CLERK_JWT_KEY, otherwise against the instance's keys, which the SDK fetches with the
 * secret key and caches. The email is not in a session token, so the user is then read
 * from Clerk's API, and the session the token belongs to is checked and then revoked
 * there. That is three calls per sign-in, not per request, because Appsgain's own session
 * takes over from here.
 *
 * Revoking is what makes the hand-off single-use. A signature check alone would accept the
 * same token, or a fresh one from the same Clerk session, until it expired, and the only
 * thing ending that session would be the browser's own sign-out — which a closed tab or a
 * dropped connection skips, leaving a Clerk session in a cookie for whoever uses the
 * browser next.
 *
 * Nothing in here depends on whether the keys belong to a Clerk development or production
 * instance: the deployed site runs on a development instance until there is a domain.
 */
@Injectable()
export class ClerkBackendVerifier extends ClerkIdentityVerifier {
  private readonly logger = new Logger(ClerkBackendVerifier.name);
  private client?: ClerkClient;

  constructor(private readonly config: ConfigService) {
    super();
  }

  get enabled(): boolean {
    return Boolean(this.secretKey());
  }

  async identify(sessionToken: string): Promise<ClerkIdentity> {
    const secretKey = this.secretKey();
    if (!secretKey) throw new ServiceUnavailableException(SSO_NOT_CONFIGURED);

    const claims = await verifyToken(sessionToken, {
      secretKey,
      // A PEM pasted into a one-line .env value arrives with literal "\n"s; the SDK only
      // strips real line breaks, so turn them back into those.
      jwtKey: this.config.get<string>("CLERK_JWT_KEY")?.replace(/\\n/g, "\n").trim() || undefined,
      authorizedParties: clerkAuthorizedParties({
        API_CORS_ORIGINS: this.config.get<string>("API_CORS_ORIGINS"),
        WEB_APP_URL: this.config.get<string>("WEB_APP_URL"),
      }),
    }).catch((error: unknown) => {
      throw this.translate(error);
    });

    // `act` marks a session someone opened *as* this person from the Clerk dashboard.
    // Clerk vouching for an address is the whole basis of this sign-in, so a session the
    // address's owner did not open themselves proves nothing about them.
    if (claims.act) throw new UnauthorizedException(SSO_REJECTED);
    // A pending session has steps left to finish in Clerk; Clerk's own SDKs treat it as
    // signed out, and so does this.
    if (claims.sts && claims.sts !== "active") throw new UnauthorizedException(SSO_REJECTED);
    // Every session token names its session; one that does not cannot be revoked below.
    if (typeof claims.sid !== "string" || !claims.sid) {
      throw new UnauthorizedException(SSO_REJECTED);
    }
    const sessionId = claims.sid;

    this.client ??= createClerkClient({ secretKey });
    const client = this.client;
    const [session, user] = await Promise.all([
      client.sessions.getSession(sessionId),
      client.users.getUser(claims.sub),
    ]).catch((error: unknown) => {
      throw this.translate(error);
    });

    // Signed out, revoked — or already traded here, since that revokes it — while the
    // token was still within its minute. The token outlives its session; this does not.
    if (session.status !== "active" || session.userId !== claims.sub) {
      throw new UnauthorizedException(SSO_REJECTED);
    }
    await client.sessions.revokeSession(sessionId).catch((error: unknown) => {
      throw this.translate(error);
    });

    const primary = user.primaryEmailAddress;
    return {
      userId: user.id,
      primaryEmail: primary
        ? { address: primary.emailAddress, verified: primary.verification?.status === "verified" }
        : null,
      name: user.fullName?.trim() || null,
      provider: providerOf(primary),
    };
  }

  /**
   * A token Clerk refuses is the caller's problem (401); Clerk being unreachable, or
   * refusing *our* key, is ours (503, and logged, because only an operator can fix it).
   */
  private translate(error: unknown): Error {
    const reason = tokenErrorReason(error);
    if (reason) {
      const ours =
        reason === TokenVerificationErrorReason.RemoteJWKFailedToLoad ||
        reason === TokenVerificationErrorReason.InvalidSecretKey ||
        reason === TokenVerificationErrorReason.LocalJWKMissing;
      if (!ours) return new UnauthorizedException(SSO_REJECTED);
      this.logger.error(`Clerk token verification could not run: ${reason}`);
      return new ServiceUnavailableException(SSO_UNAVAILABLE);
    }

    if (isClerkAPIResponseError(error)) {
      // The guard is overloaded (it doubles as a method), which defeats narrowing.
      const { status } = error as ClerkAPIResponseError;
      // 401 and 403 are Clerk refusing our secret key, and 429 and 5xx are Clerk itself;
      // any other 4xx is about what the token points at — a user deleted, or a session
      // ended, moments ago — so the sign-in is refused rather than the server blamed.
      const ours = status === 401 || status === 403 || status === 429 || status >= 500;
      if (!ours) return new UnauthorizedException(SSO_REJECTED);
      this.logger.error(`Clerk API refused a request: HTTP ${status}`);
      return new ServiceUnavailableException(SSO_UNAVAILABLE);
    }

    this.logger.error(
      `Clerk could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
    return new ServiceUnavailableException(SSO_UNAVAILABLE);
  }

  private secretKey(): string | undefined {
    return this.config.get<string>("CLERK_SECRET_KEY")?.trim() || undefined;
  }
}
