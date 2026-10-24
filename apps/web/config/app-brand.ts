/**
 * The *product* brand — Appsgain Technologies, the vendor — as distinct from the
 * customer's workspace, whose name comes from the signed-in session (the sidebar's
 * workspace row) and whose white-label payload has the shape in `config/branding.ts`
 * (TRD §12). Two different things that both get called "the brand":
 *
 *   - Before sign-in there is no tenant yet, so every auth screen wears this one.
 *   - Inside the app the sidebar mark is the product too, the way a SaaS dashboard
 *     normally works; the workspace row under it is the tenant's own.
 *
 * Keeping them apart is what lets a white-labelled tenant change its colours without
 * repainting the vendor's logo.
 *
 * The contact and pricing fields below are vendor facts that differ per deployment, so
 * they come from NEXT_PUBLIC_ variables, built into the pages at deploy time.
 */
export interface AppBrand {
  name: string;
  /** Rendered as two words on the stacked lockup: "Appsgain" over "Technologies". */
  nameLines: [string, string];
  tagline: string;
  /** The three gradient stops, left to right, shared by the mark and the CTA buttons. */
  gradient: { from: string; via: string; to: string };
  /**
   * Where customers write for what the app cannot do for them yet — deleting a workspace,
   * and talking to sales from the plans page. From NEXT_PUBLIC_SUPPORT_EMAIL, built into
   * the pages at deploy time. Null until it is set: the app then says to contact support
   * without offering a link to an address that may not exist.
   */
  supportEmail: string | null;
  /**
   * The number the plans page offers beside (or instead of) the email, as a tel: link.
   * From NEXT_PUBLIC_SUPPORT_PHONE, written any readable way ("+91 98765 43210"): it is
   * shown as written and dialled as digits. Null until it is set, and then no number is
   * offered anywhere.
   */
  supportPhone: string | null;
  /**
   * The line under the prices saying what they include — whether GST is extra, for one.
   * From NEXT_PUBLIC_PRICE_TAX_NOTE. Until it is set the default commits to nothing more
   * than the currency and that taxes apply, because quoting prices inclusive or exclusive
   * of GST is the owner's decision, not the code's.
   */
  priceTaxNote: string;
}

export const DEFAULT_PRICE_TAX_NOTE = "All prices are in Indian rupees (₹). Taxes as applicable.";

export const appBrand: AppBrand = {
  name: "Appsgain Technologies",
  nameLines: ["appsgain", "technologies"],
  tagline: "AI Powered IT Services",
  gradient: { from: "#F7671E", via: "#E5199B", to: "#9333EA" },
  // Read as a literal property so Next.js inlines it into the client bundle.
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null,
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim() || null,
  priceTaxNote: process.env.NEXT_PUBLIC_PRICE_TAX_NOTE?.trim() || DEFAULT_PRICE_TAX_NOTE,
};

/** The CSS value used by `.brand-gradient` and by inline fills that need to match it. */
export const BRAND_GRADIENT = `linear-gradient(97deg, ${appBrand.gradient.from} 0%, ${appBrand.gradient.via} 58%, ${appBrand.gradient.to} 100%)`;
