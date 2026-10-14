/**
 * Switches for screens that exist in the codebase but are not ready to be shown to
 * customers. Each one is a NEXT_PUBLIC_ variable, so it is built into the pages at deploy
 * time: turning one on or off needs a new deployment, not a restart.
 *
 * Everything here is OFF unless the variable says otherwise. A switch that defaulted to
 * on would put an unfinished screen in front of every customer the first time someone
 * forgot to set it.
 */

/** "1", "true", "yes" and "on", in any case, turn a switch on. Anything else leaves it off. */
export function isFlagOn(value: string | undefined | null): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export const features = {
  /**
   * Find Leads (AI). The screen is a preview over sample rows: there is no licensed data
   * source behind it yet, so nothing on it is searched, saved or imported. Off, the route
   * shows a "coming soon" page and the sidebar and the Leads page leave it out.
   */
  // Read as a literal property so Next.js inlines it into the client bundle.
  findLeads: isFlagOn(process.env.NEXT_PUBLIC_FEATURE_FIND_LEADS),
} as const;
