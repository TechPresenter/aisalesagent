/**
 * TRD §12 — every workspace stores a `branding_config` and the app renders itself in
 * the tenant's identity. The seed workspace is a generic B2B software reseller, chosen
 * so the demo reads as the product rather than as one customer's vertical; swapping this
 * object is the whole white-label story from the UI side, which is why no component
 * hard-codes a tenant name.
 */
export interface BrandingConfig {
  tenantName: string;
  tagline: string;
  /** Two-letter monogram used in the sidebar mark and as the favicon fallback. */
  monogram: string;
  primaryColor: string;
  primaryDark: string;
  subdomain: string;
}

export const tenantBranding: BrandingConfig = {
  tenantName: "Northwind Solutions",
  tagline: "B2B Software & IT Services",
  monogram: "NS",
  primaryColor: "#19B969",
  primaryDark: "#0F6941",
  subdomain: "northwind.appsgain.app",
};

export interface CurrentUser {
  name: string;
  role: string;
  initials: string;
}

export const currentUser: CurrentUser = {
  name: "Shailesh",
  role: "Admin",
  initials: "SS",
};
