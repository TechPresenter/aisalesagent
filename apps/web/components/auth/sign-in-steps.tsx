"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { GradientButton, OtpInput } from "@/components/auth/auth-ui";
import { ApiError, authApi, type TwoFactorChallenge } from "@/lib/api-client";

/**
 * The steps a sign-in shares however it began — with a password (SignInForm) or with
 * Google or Microsoft (SsoComplete). Kept in one place so an account with 2FA meets the
 * same code screen either way, and so a Google sign-in can never take a shortcut past it.
 */

const CODE_LENGTH = 6;

/**
 * Into the app once a session is stored. `refresh()` alongside the navigation because the
 * shell reads the session on render; without it the dashboard can paint once with the
 * pre-login cache.
 *
 * `replace` takes the current page out of history: the Google or Microsoft return page,
 * which has nothing to show anyone who comes Back to it.
 */
export function useEnterApp(): (destination?: string, options?: { replace?: boolean }) => void {
  const router = useRouter();
  return (destination = "/", options = {}) => {
    if (options.replace) router.replace(destination);
    else router.push(destination);
    router.refresh();
  };
}

/**
 * Sign-in, step two. The six boxes take the authenticator code; a lost phone is what the
 * backup-code field is for. An expired challenge (five minutes) sends the person back to
 * the first step rather than leaving them typing codes that can no longer work.
 *
 * `expiredMessage` replaces the API's own expiry sentence, which asks for the password
 * again — the wrong instruction after a Google or Microsoft sign-in.
 */
export function TwoFactorStep({
  challenge,
  onSignedIn,
  onStartOver,
  expiredMessage,
}: {
  challenge: TwoFactorChallenge;
  onSignedIn: () => void;
  onStartOver: () => void;
  expiredMessage?: string;
}) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const code = useBackup ? backupCode.trim() : digits.join("");
  const ready = useBackup
    ? code.replace(/[^a-z0-9]/gi, "").length === 8
    : code.length === CODE_LENGTH;

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.completeTwoFactor({ challengeToken: challenge.challengeToken, code });
      onSignedIn();
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : "Could not reach the server. Try again.";
      setError(message);
      setDigits(Array(CODE_LENGTH).fill(""));
      setSubmitting(false);
    }
  }

  const expired = error?.includes("expired");

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-magenta/[0.1]">
          <ShieldCheck className="h-6 w-6 text-brand-magenta" strokeWidth={2} />
        </span>
        <p className="mt-3 text-[16px] font-bold text-brand-navy">Two-step verification</p>
        <p className="mt-1 max-w-[320px] text-[13px] leading-relaxed text-slate-500">
          {useBackup
            ? "Enter one of the backup codes you saved when you turned on two-factor authentication."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
      </div>

      {useBackup ? (
        <input
          value={backupCode}
          onChange={(event) => setBackupCode(event.target.value)}
          placeholder="xxxx-xxxx"
          autoComplete="one-time-code"
          autoFocus
          aria-label="Backup code"
          className="h-[52px] w-full rounded-btn border border-slate-200 bg-surface text-center font-mono text-[18px] tracking-[0.2em] text-brand-navy placeholder:text-slate-300 focus:border-brand-magenta focus:outline-none focus:ring-2 focus:ring-brand-magenta/20"
        />
      ) : (
        <OtpInput length={CODE_LENGTH} value={digits} onChange={setDigits} />
      )}

      {error && (
        <p
          role="alert"
          className="rounded-btn bg-alert-red/[0.08] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
        >
          {expired && expiredMessage ? expiredMessage : error}
        </p>
      )}

      <GradientButton type="submit" disabled={!ready || submitting || expired}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
            Verifying&hellip;
          </>
        ) : (
          "Verify & Sign In"
        )}
      </GradientButton>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <button
          type="button"
          onClick={() => {
            setUseBackup(!useBackup);
            setError(null);
          }}
          className="font-semibold text-brand-magenta hover:underline"
        >
          {useBackup ? "Use the authenticator app" : "Use a backup code"}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="font-semibold text-slate-500 hover:text-brand-navy"
        >
          {expired ? "Sign in again" : "Start over"}
        </button>
      </div>
    </form>
  );
}
