"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Loader2, ShieldCheck } from "lucide-react";
import { Field, GradientButton, OtpInput } from "@/components/auth/auth-ui";
import { ApiError, authApi, type TwoFactorChallenge } from "@/lib/api-client";

const CODE_LENGTH = 6;

/**
 * The real sign-in form: it posts to `POST /auth/login`, stores the returned tokens and
 * only then navigates. A failure keeps the user on the page with the reason, because the
 * alternative — routing to a dashboard that will 401 on its first request — turns a
 * wrong password into a broken app.
 *
 * The workspace field exists because email is unique per workspace rather than globally
 * (see `LoginRequest` in @appsgain/shared). A deployed environment reads it from the
 * host; localhost has no subdomain to read, so here it is asked for. Outside production it
 * defaults to the seeded workspace; a production database has no such workspace.
 *
 * An account with two-factor authentication gets a challenge back instead of a session,
 * and the form becomes step two: a code from the authenticator app, or a backup code.
 */
export function SignInForm() {
  const router = useRouter();
  const [subdomain, setSubdomain] = useState(process.env.NODE_ENV === "production" ? "" : "northwind");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);

  function enterApp() {
    // `refresh()` alongside `push()` because the shell reads the session on render;
    // without it the dashboard can paint once with the pre-login cache.
    router.push("/");
    router.refresh();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await authApi.login({ subdomain: subdomain.trim(), email: email.trim(), password });
      if ("twoFactorRequired" in result) {
        setChallenge(result);
        setSubmitting(false);
        return;
      }
      enterApp();
    } catch (cause) {
      // 401 is the expected failure and gets the careful wording — never "no such user",
      // which would let anyone enumerate who holds an account in a workspace.
      setError(
        cause instanceof ApiError && cause.status === 401
          ? "Those credentials do not match an account in this workspace. After five failed attempts, sign-in pauses for 15 minutes."
          : cause instanceof ApiError && cause.status === 429
            ? "Too many attempts. Wait a moment and try again."
            : "Could not reach the server. Check that the API is running and try again.",
      );
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <TwoFactorStep
        challenge={challenge}
        onSignedIn={enterApp}
        onStartOver={() => {
          setChallenge(null);
          setPassword("");
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      <div className="relative rounded-btn border border-slate-200 bg-surface transition-colors focus-within:border-brand-magenta focus-within:ring-2 focus-within:ring-brand-magenta/20">
        <Building2
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"
          strokeWidth={1.9}
          aria-hidden
        />
        <label
          htmlFor="workspace"
          className="pointer-events-none absolute left-11 top-1.5 text-[10.5px] font-medium text-slate-400"
        >
          Workspace
        </label>
        <input
          id="workspace"
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value)}
          autoComplete="organization"
          required
          className="h-[58px] w-full rounded-btn bg-transparent pl-11 pr-3.5 pt-4 text-[14px] text-brand-navy placeholder:text-slate-400 focus:outline-none"
        />
      </div>

      <Field
        label="Email"
        icon="mail"
        type="email"
        placeholder="you@yourcompany.com"
        autoComplete="email"
        value={email}
        onChange={setEmail}
      />
      <Field
        label="Password"
        icon="lock"
        type="password"
        placeholder="Enter your password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />

      {error && (
        <p
          role="alert"
          className="rounded-btn bg-alert-red/[0.08] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            defaultChecked
            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#E5199B]"
          />
          Remember me
        </label>
        <Link
          href="/forgot-password"
          className="text-[13px] font-semibold text-brand-magenta hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <div className="pt-1.5">
        <GradientButton type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              Signing in&hellip;
            </>
          ) : (
            "Sign In"
          )}
        </GradientButton>
      </div>

      {/* The seeded logins, shown only outside production. A demo nobody can get into is
          not a demo, and hunting for credentials in a seed script is not onboarding. */}
      {process.env.NODE_ENV !== "production" && (
        <div className="rounded-lg bg-slate-50 p-3 text-[11.5px] leading-relaxed text-slate-500">
          <span className="font-semibold text-brand-navy">Demo accounts</span> — password{" "}
          <code className="rounded bg-white px-1 py-0.5 font-mono">Appsgain#2026</code>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {[
              ["owner@northwind.test", "Owner"],
              ["manager@northwind.test", "Manager"],
              ["agent@northwind.test", "Agent"],
              ["viewer@northwind.test", "Viewer"],
            ].map(([address, label]) => (
              <button
                key={address}
                type="button"
                onClick={() => {
                  setSubdomain("northwind");
                  setEmail(address);
                  setPassword("Appsgain#2026");
                }}
                className="font-medium text-accent-blue hover:underline"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Sign-in, step two. The six boxes take the authenticator code; a lost phone is what the
 * backup-code field is for. An expired challenge (five minutes) sends the person back to
 * the password step rather than leaving them typing codes that can no longer work.
 */
function TwoFactorStep({
  challenge,
  onSignedIn,
  onStartOver,
}: {
  challenge: TwoFactorChallenge;
  onSignedIn: () => void;
  onStartOver: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const code = useBackup ? backupCode.trim() : digits.join("");
  const ready = useBackup ? code.replace(/[^a-z0-9]/gi, "").length === 8 : code.length === CODE_LENGTH;

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.completeTwoFactor({ challengeToken: challenge.challengeToken, code });
      onSignedIn();
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "Could not reach the server. Try again.";
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
        <p role="alert" className="rounded-btn bg-alert-red/[0.08] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]">
          {error}
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
        <button type="button" onClick={onStartOver} className="font-semibold text-slate-500 hover:text-brand-navy">
          {expired ? "Sign in again" : "Start over"}
        </button>
      </div>
    </form>
  );
}
