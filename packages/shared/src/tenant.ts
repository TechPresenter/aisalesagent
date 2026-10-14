import type { LoginResponse } from "./auth";
import type { Role } from "./roles";

/** TRD §7 — Tenant.status. A suspended workspace can still log in to see billing. */
export const TENANT_STATUSES = ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_STATUSES = ["ACTIVE", "INVITED", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * TRD §12 / Brand Guidelines §12 — the white-label payload stored on the Tenant. The web
 * app's `config/branding.ts` is this shape standing in for the column until the API lands.
 */
export interface BrandingConfig {
  tenantName: string;
  tagline: string;
  monogram: string;
  primaryColor: string;
  primaryDark: string;
  subdomain: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  industryVertical: string | null;
  subdomain: string;
  status: TenantStatus;
  brandingConfig: BrandingConfig | null;
  createdAt: string;
}

/**
 * TRD §8 — `POST /workspace`, the self-serve signup. One request creates the Tenant and
 * its OWNER user together; there is no state in which a workspace exists without an owner.
 */
export interface CreateWorkspaceRequest {
  /** Workspace / company name. */
  name: string;
  /** Lowercase, hyphen-separated; becomes `{subdomain}.appsgain.app` and must be unique. */
  subdomain: string;
  industryVertical?: string;
  ownerName: string;
  ownerEmail: string;
  /** Required unless `ssoToken` is sent; never both. */
  ownerPassword?: string;
  /**
   * The `signupToken` from a Google or Microsoft sign-in that found no account. Replaces
   * the password: `ownerEmail` must be the address that sign-in proved, and the owner
   * starts with that email already verified.
   */
  ssoToken?: string;
}

export interface CreateWorkspaceResponse {
  tenant: TenantSummary;
  owner: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
  /**
   * Present only for a signup with `ssoToken`: the owner, signed in. A password signup
   * signs in with `POST /auth/login` as before; an SSO signup has no password to do that with.
   */
  session?: LoginResponse;
}
