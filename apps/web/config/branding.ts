/**
 * TRD §12 — every workspace stores a `branding_config`, and white-labelling renders the
 * app in the tenant's identity. This is the shape of that payload (it mirrors
 * `BrandingConfig` in packages/shared/src/tenant.ts) and one sample of it.
 *
 * The sample is NOT what the app shows a customer. It used to be: the sidebar and the
 * dashboard tagline read this object, so every workspace, whatever its name, was greeted
 * as the demo company. The sidebar now shows the signed-in workspace's own name from the
 * session, on the product green, and nothing customer-facing imports this file. What is
 * left is the style guide's white-label specimen, which renders the workspace row in these
 * colours to show what a branded workspace will look like once per-workspace branding is
 * read from the API.
 *
 * It matches the seeded demo workspace (subdomain `northwind` in apps/api/prisma/seed.ts),
 * so the specimen and the demo data agree.
 */
export interface BrandingConfig {
  tenantName: string;
  tagline: string;
  /** Two-letter monogram used in the workspace mark and as the favicon fallback. */
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
