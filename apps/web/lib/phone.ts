/**
 * Browser-side phone normalisation for the CSV import preview.
 *
 * This mirrors `normalisePhone` in apps/api/src/leads/leads.dedupe.ts, which is the
 * authority — the server normalises again on import and its answer is what gets stored.
 * The duplication is deliberate and narrow: the mapping screen has to show the user what
 * their numbers will become *before* it uploads anything, and it cannot ask the server
 * without sending the file first.
 *
 * If the two ever disagree the preview is wrong and the import is right, which is the
 * safe direction for the discrepancy to run. Keep them in step.
 */

const DEFAULT_COUNTRY_CODE = "91";
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export function normalisePhonePreview(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;

  const withoutTrunk = digits.replace(/^0+/, "");

  if (INDIAN_MOBILE.test(withoutTrunk)) {
    return DEFAULT_COUNTRY_CODE + withoutTrunk;
  }

  if (withoutTrunk.length === 12 && withoutTrunk.startsWith(DEFAULT_COUNTRY_CODE)) {
    return INDIAN_MOBILE.test(withoutTrunk.slice(2)) ? withoutTrunk : null;
  }

  if (withoutTrunk.length >= 8 && withoutTrunk.length <= 15) {
    return withoutTrunk;
  }

  return null;
}
