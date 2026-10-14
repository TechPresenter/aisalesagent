/**
 * Whether internal pages — today the /style-guide component catalogue — answer at all.
 *
 * They are for building the app, not for customers: the catalogue renders sample data and
 * the demo workspace's branding, and on a public deployment it is an unlinked page that
 * still shows up for anyone who guesses the URL. So they 404 on any production build.
 *
 * VERCEL_ENV is checked as well as NODE_ENV so the rule holds, and can be tested, under
 * `next dev` with VERCEL_ENV=production set; NODE_ENV alone is "production" for every
 * built deployment (DEV, QA and UAT included), which is intended — `next dev` is where
 * the catalogue is used.
 */
export function internalPagesHidden(env: { NODE_ENV?: string; VERCEL_ENV?: string }): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}
