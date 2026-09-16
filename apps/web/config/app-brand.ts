/**
 * The *product* brand — Appsgain Technologies, the vendor — as distinct from
 * `tenantBranding`, which is the customer workspace the dashboard renders itself in
 * (TRD §12). Two different things that both get called "the brand":
 *
 *   - Before sign-in there is no tenant yet, so every auth screen wears this one.
 *   - Inside the app the sidebar mark is the product too, the way a SaaS dashboard
 *     normally works; the tenant's own name and colours still drive the workspace.
 *
 * Keeping them in separate objects is what lets a white-labelled tenant change its
 * colours without repainting the vendor's logo.
 */
export interface AppBrand {
  name: string;
  /** Rendered as two words on the stacked lockup: "Appsgain" over "Technologies". */
  nameLines: [string, string];
  tagline: string;
  /** The three gradient stops, left to right, shared by the mark and the CTA buttons. */
  gradient: { from: string; via: string; to: string };
}

export const appBrand: AppBrand = {
  name: "Appsgain Technologies",
  nameLines: ["appsgain", "technologies"],
  tagline: "AI Powered IT Services",
  gradient: { from: "#F7671E", via: "#E5199B", to: "#9333EA" },
};

/** The CSS value used by `.brand-gradient` and by inline fills that need to match it. */
export const BRAND_GRADIENT = `linear-gradient(97deg, ${appBrand.gradient.from} 0%, ${appBrand.gradient.via} 58%, ${appBrand.gradient.to} 100%)`;
