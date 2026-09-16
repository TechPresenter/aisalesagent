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

export interface RefreshRequest {
  refreshToken: string;
}

export type RefreshResponse = AuthTokens;

export interface LogoutRequest {
  refreshToken: string;
}
