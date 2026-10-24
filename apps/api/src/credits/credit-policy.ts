/**
 * The three numbers that decide how credits appear without a payment: what a new
 * workspace starts with, how long its trial lasts, and how much the platform operator may
 * hand one workspace in a day.
 *
 * They are the owner's decisions, not the code's, so they come from the environment. The
 * defaults are the cautious ones: no free credits, a trial that never expires (which is
 * how every workspace behaved before these existed), and an operator cap low enough that
 * a stolen operator session cannot mint a fortune before somebody notices.
 *
 * Read once at boot (validateEnv calls this too), so a typo fails the deploy with a clear
 * message instead of quietly granting nothing — or everything.
 */
export interface CreditPolicy {
  /** Credits every new workspace's wallet starts with, as one PLAN_GRANT ledger row. */
  trialCredits: number;
  /** Days a new workspace stays in TRIAL before it turns read-only. 0 means never. */
  trialDays: number;
  /** Most credits the operator console may grant one workspace in any 24 hours. */
  operatorDailyGrantCap: number;
}

interface Setting {
  env: string;
  fallback: number;
  max: number;
}

const SETTINGS: Record<keyof CreditPolicy, Setting> = {
  trialCredits: { env: "TRIAL_CREDITS", fallback: 0, max: 1_000_000 },
  trialDays: { env: "TRIAL_DAYS", fallback: 0, max: 3_650 },
  operatorDailyGrantCap: { env: "OPERATOR_DAILY_CREDIT_CAP", fallback: 10_000, max: 10_000_000 },
};

export const CREDIT_POLICY_ENV = Object.values(SETTINGS).map((setting) => setting.env);

export function readCreditPolicy(env: Record<string, unknown>): CreditPolicy {
  const read = ({ env: key, fallback, max }: Setting): number => {
    const raw = env[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;

    const text = String(raw).trim();
    // Digits only: "1e3", "100.5" and "-1" are all refused rather than coerced, because
    // a number of credits that means something other than what was typed is worse than
    // a boot that stops and says so.
    if (!/^\d+$/.test(text) || Number(text) > max) {
      throw new Error(`${key} must be a whole number from 0 to ${max} — got "${text}"`);
    }
    return Number(text);
  };

  return {
    trialCredits: read(SETTINGS.trialCredits),
    trialDays: read(SETTINGS.trialDays),
    operatorDailyGrantCap: read(SETTINGS.operatorDailyGrantCap),
  };
}

/** When a workspace created now stops being a trial, or null when trials do not expire. */
export function trialEndsAt(policy: Pick<CreditPolicy, "trialDays">, from = new Date()): Date | null {
  if (policy.trialDays <= 0) return null;
  return new Date(from.getTime() + policy.trialDays * 24 * 60 * 60 * 1000);
}
