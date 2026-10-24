import type { Role } from "./roles";

/**
 * TRD §8 — "/auth: POST /auth/login, /auth/refresh, /auth/sso. Issues short-lived JWT +
 * refresh token." These are the wire shapes; apps/api validates incoming bodies against
 * DTOs that implement them and apps/web types its fetch calls with them.
 */

/**
 * The access-token claim set. `tenantId` is not decoration — it is the isolation
 * boundary: every tenant-scoped query in the API is filtered by the tenantId in this
 * payload, never by one taken from the URL or body.
 *
 * A SUPER_ADMIN token still carries a tenantId (the Appsgain workspace); the difference
 * is that the role permits stepping outside it, not that the claim is missing.
 */
export interface JwtAccessPayload {
  /** User id — `sub` per RFC 7519. */
  sub: string;
  tenantId: string;
  role: Role;
  email: string;
  /**
   * Present only when the user holds a workspace-defined role, in which case it replaces
   * the system role's grants entirely (see `hasPermission`). Carried in the token rather
   * than looked up per request: authorisation runs on every call, and a database round
   * trip on each one to read a set that changes a few times a year is the wrong trade.
   *
   * The cost is that a permission change takes effect on the next refresh rather than
   * instantly — bounded by JWT_ACCESS_TTL, 15 minutes by default. Revoking access
   * urgently is `status: DISABLED` plus refresh-token revocation, which is immediate
   * because both are checked against the database.
   */
  perms?: string[];
  /**
   * Present when the request authenticated with an API key instead of a session. The
   * principal acts as the key's creator, with `perms` set to the key's scopes, and may only
   * call routes that declare a permission (see PermissionGuard).
   */
  apiKeyId?: string;
  /** Issued-at and expiry, seconds since epoch; added by the signer. */
  iat?: number;
  exp?: number;
}

/**
 * Refresh tokens carry the minimum needed to re-issue: identity plus the rotation id.
 * No role or tenant claim, because both are re-read from the database on refresh — a
 * user demoted or moved between tenants must not be able to refresh their way back.
 */
export interface JwtRefreshPayload {
  sub: string;
  /** Id of the RefreshToken row, so a single session can be revoked on logout. */
  jti: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, so the client can schedule a refresh. */
  expiresIn: number;
}

/** The caller's own identity, as returned alongside a successful login. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  tenantName: string;
}

/**
 * Email is unique *per tenant*, not globally — the same person can hold accounts in two
 * workspaces — so the workspace has to be named at login or the credentials are
 * ambiguous. The web app takes it from the subdomain it is served on.
 */
export interface LoginRequest {
  subdomain: string;
  email: string;
  password: string;
}

export interface LoginResponse extends AuthTokens {
  user: SessionUser;
}

/**
 * What `POST /auth/login` returns instead of a session when the password was right but
 * the account has two-factor authentication on: a short-lived challenge to send back with
 * the code to `POST /auth/login/2fa`, which is what issues the tokens.
 */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
  /** Seconds the challenge stays valid. */
  expiresIn: number;
}

export type LoginResult = LoginResponse | TwoFactorChallenge;

// ── Google and Microsoft sign-in (Clerk) ────────────────────────────────────────────

/**
 * `POST /auth/sso/clerk` — the Clerk session token the browser holds after the Google or
 * Microsoft redirect. Clerk only vouches for the email address; which Appsgain account
 * that address opens is decided here. `subdomain` is the workspace the person was signing
 * in to, when the page knows it.
 */
export interface ClerkSignInRequest {
  token: string;
  subdomain?: string;
}

/** `POST /auth/sso/select` — the workspace picked from a `choose-workspace` answer. */
export interface SsoSelectRequest {
  selectionToken: string;
  subdomain: string;
}

/**
 * A sign-in through Google or Microsoft that found the account: the same session or 2FA
 * challenge `POST /auth/login` returns, so the challenge goes to `POST /auth/login/2fa`.
 *
 * `passwordCleared` is set when the person has just taken over an account whose email had
 * never been confirmed (one a `choose-workspace` answer flagged `unconfirmed`). Whoever
 * created it may not have been the address's owner, so the password, the two-factor
 * enrolment and every session they set up are gone, and the answer is always a session;
 * the page should say so.
 */
export type SsoSignedIn = LoginResult & { passwordCleared?: true };

/**
 * The address is known here, just not as an account it can sign in to: turned off in a
 * workspace, or invited to one and not yet joined. Only ever told to the person who has
 * just proved they own the address.
 */
export interface SsoKnownAddress {
  reason: "disabled" | "invited";
  /** The workspace's display name. */
  workspace: string;
}

/**
 * What creating a workspace for the address needs: `signupToken` stands in for the
 * password on `POST /workspace` (as `ssoToken`), for the email it was issued for.
 */
export interface SsoSignupOffer {
  signupToken: string;
  email: string;
  /** The name on the Google or Microsoft account, to prefill the form. */
  name: string | null;
  /** Seconds the signup token stays valid. */
  expiresIn: number;
  /** Set when the sign-up page should say where else the address is known. */
  known?: SsoKnownAddress;
}

/** No account uses this address yet: a workspace can be created for it. */
export interface SsoSignupRequired extends SsoSignupOffer {
  status: "signup-required";
}

/**
 * An account whose email was never confirmed. Anyone can sign up with someone else's
 * address, so whoever set it up may not be the person now proving they own it. The counts
 * are what that creator may still control in the workspace, shown before the pick so the
 * owner can tell whether it is theirs; picking it takes the account over.
 */
export interface SsoUnconfirmedAccount {
  /** ISO time the account was created. */
  createdAt: string;
  /** Other people who can sign in to the workspace. */
  otherMembers: number;
  /** Invitations to join it that can still be accepted. */
  pendingInvitations: number;
  /** API keys that still work. */
  apiKeys: number;
  /** Webhooks switched on. */
  webhooks: number;
}

export interface SsoWorkspaceOption {
  subdomain: string;
  name: string;
  /** Present when the account in this workspace never confirmed its email. */
  unconfirmed?: SsoUnconfirmedAccount;
}

/**
 * The address has accounts in more than one workspace, none was named (or the one named
 * is not among them), or the only match is an account that never confirmed its email.
 * Send the pick back with `selectionToken` to `POST /auth/sso/select`.
 */
export interface SsoWorkspaceChoice {
  status: "choose-workspace";
  selectionToken: string;
  workspaces: SsoWorkspaceOption[];
  /** Seconds the selection token stays valid. */
  expiresIn: number;
  /**
   * Present when every workspace listed is `unconfirmed`: none of them may be the
   * person's own, so they may create a workspace instead, as after `signup-required`.
   */
  signup?: SsoSignupOffer;
}

export type SsoSignInResult = SsoSignedIn | SsoSignupRequired | SsoWorkspaceChoice;

export interface RefreshRequest {
  refreshToken: string;
}

export type RefreshResponse = AuthTokens;

export interface LogoutRequest {
  refreshToken: string;
}
