"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, CircleAlert, Info, Loader2 } from "lucide-react";
import {
  AuthCard,
  Field,
  GradientButton,
  OtpInput,
  PasswordStrength,
  passwordScore,
} from "@/components/auth/auth-ui";
import { ApiError, authApi, getSessionUser, type InvitationPreview } from "@/lib/api-client";

const MIN_PASSWORD = 12;
const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

function messageOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status < 500
    ? cause.message
    : "Could not reach the server. Check that the API is running and try again.";
}

/** Only same-site paths, so `?next=` cannot be used to bounce someone to another site. */
export function safeNext(next: string | undefined, fallback = "/"): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-btn bg-alert-red/[0.08] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]">
      <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2.2} />
      <span>{children}</span>
    </p>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-btn bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-500">
      <Info className="mt-px h-4 w-4 shrink-0 text-slate-400" strokeWidth={2.2} />
      <span>{children}</span>
    </p>
  );
}

/** What to say about email delivery, when there is something to say. */
function MailNote({ mail }: { mail: { deliverable: boolean; devLog: boolean } | null }) {
  if (!mail) return null;
  if (!mail.deliverable) {
    return (
      <Problem>
        This server cannot send email yet, so no message will arrive. Ask whoever runs Appsgain to configure
        MAIL_DRIVER, or your workspace owner to help.
      </Problem>
    );
  }
  if (mail.devLog) {
    return <Note>Development server: emails are written to the API log instead of being sent.</Note>;
  }
  return null;
}

// ── forgot password ─────────────────────────────────────────────────────────────────

/**
 * Feature List §1 — password reset, step one.
 *
 * The confirmation reads the same whether or not the address has an account, because the
 * server answers the same way: telling a stranger "no account for that email" would turn
 * this page into a directory of who works where.
 */
export function ForgotPasswordForm({ illustration }: { illustration: ReactNode }) {
  const [subdomain, setSubdomain] = useState(process.env.NODE_ENV !== "production" ? "northwind" : "");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mail, setMail] = useState<{ deliverable: boolean; devLog: boolean } | null>(null);

  useEffect(() => {
    authApi.mailStatus().then(setMail, () => setMail(null));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.forgotPassword({ subdomain: subdomain.trim().toLowerCase(), email: email.trim() });
      setSent(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center text-center">
        {illustration}
        <p className="mt-3 text-[15px] font-bold text-brand-navy">Check your inbox</p>
        <p className="mt-1 max-w-[320px] text-[13px] leading-relaxed text-slate-500">
          If <span className="font-semibold text-brand-navy">{email.trim()}</span> has an account in the{" "}
          <span className="font-semibold text-brand-navy">{subdomain.trim()}</span> workspace, a reset link is on its
          way. It works once, within an hour.
        </p>
        <div className="mt-4 w-full space-y-3 text-left">
          <MailNote mail={mail} />
        </div>
        <div className="mt-5 flex w-full flex-col gap-2.5">
          <GradientButton href="/sign-in">Back to Sign In</GradientButton>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="text-[13px] font-semibold text-brand-magenta hover:underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  const ready = subdomain.trim().length >= 3 && /\S+@\S+\.\S+/.test(email.trim());

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div className="relative rounded-btn border border-slate-200 bg-surface transition-colors focus-within:border-brand-magenta focus-within:ring-2 focus-within:ring-brand-magenta/20">
        <Building2
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"
          strokeWidth={1.9}
          aria-hidden
        />
        <label
          htmlFor="reset-workspace"
          className="pointer-events-none absolute left-11 top-1.5 text-[10.5px] font-medium text-slate-400"
        >
          Workspace
        </label>
        <input
          id="reset-workspace"
          value={subdomain}
          onChange={(event) => setSubdomain(event.target.value)}
          autoComplete="organization"
          required
          className="h-[58px] w-full rounded-btn bg-transparent pl-11 pr-3.5 pt-4 text-[14px] text-brand-navy focus:outline-none"
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
      {error && <Problem>{error}</Problem>}
      {mail && !mail.deliverable && <MailNote mail={mail} />}
      <GradientButton type="submit" disabled={!ready || submitting}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
            Sending&hellip;
          </>
        ) : (
          "Send Reset Link"
        )}
      </GradientButton>
    </form>
  );
}

// ── reset password ──────────────────────────────────────────────────────────────────

/**
 * Feature List §1 — password reset, step two. The link is checked before the form is
 * shown, so someone with an expired link finds out before they invent a new password.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "invalid" | "ready">(token ? "checking" : "invalid");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    authApi.checkResetToken(token).then(
      (result) => {
        setEmail(result.email ?? null);
        setState(result.valid ? "ready" : "invalid");
      },
      () => setState("invalid"),
    );
  }, [token]);

  if (state === "checking") {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
        Checking your link&hellip;
      </p>
    );
  }

  if (state === "invalid") {
    return (
      <div className="space-y-4">
        <Problem>This reset link has expired or has already been used. Links work once, within an hour.</Problem>
        <GradientButton href="/forgot-password">Send a New Link</GradientButton>
      </div>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    password.length >= MIN_PASSWORD && passwordScore(password) >= 3 && confirm === password && !submitting;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.resetPassword({ token, password });
      router.push("/reset-password/success");
    } catch (cause) {
      setError(messageOf(cause));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {email && (
        <p className="text-center text-[13px] text-slate-500">
          For <span className="font-semibold text-brand-navy">{email}</span>
        </p>
      )}
      <div>
        <Field
          label="New Password"
          icon="lock"
          type="password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <PasswordStrength password={password} />
      </div>
      <div>
        <Field
          label="Confirm New Password"
          icon="lock"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        {mismatch && <p className="mt-1.5 text-[12px] font-medium text-alert-red">Both passwords must match.</p>}
      </div>
      {error && <Problem>{error}</Problem>}
      <Note>Resetting signs you out on every device, so you will sign in again with the new password.</Note>
      <GradientButton type="submit" disabled={!canSubmit}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
            Resetting&hellip;
          </>
        ) : (
          "Reset Password"
        )}
      </GradientButton>
    </form>
  );
}

// ── verify email ────────────────────────────────────────────────────────────────────

/**
 * Feature List §1 — email verification: a six-digit code sent to the signed-in person's
 * address. Sent when the screen opens; resend waits out the same thirty seconds the server
 * enforces. Skippable, because an unverified address limits nothing yet — Settings →
 * Security keeps offering it.
 */
export function VerifyEmailScreen({ next, illustration }: { next: string; illustration: ReactNode }) {
  const router = useRouter();
  const destination = safeNext(next);
  const [email, setEmail] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mail, setMail] = useState<{ deliverable: boolean; devLog: boolean } | null>(null);

  async function send() {
    setError(null);
    try {
      const result = await authApi.sendVerificationCode();
      if (result.alreadyVerified) {
        router.replace(destination);
        return;
      }
      setSecondsLeft(RESEND_SECONDS);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) {
        // A code went out moments ago — the one already in the inbox still works.
        setSecondsLeft(RESEND_SECONDS);
        return;
      }
      setError(messageOf(cause));
    }
  }

  useEffect(() => {
    const user = getSessionUser();
    if (!user) {
      setSignedOut(true);
      return;
    }
    setEmail(user.email);
    authApi.mailStatus().then(setMail, () => setMail(null));
    void send();
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (secondsLeft === 0) return;
    const timer = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const complete = code.every((digit) => digit !== "");

  async function verify() {
    if (!complete || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.verifyEmail(code.join(""));
      router.push(destination);
      router.refresh();
    } catch (cause) {
      setError(messageOf(cause));
      setCode(Array(CODE_LENGTH).fill(""));
      setSubmitting(false);
    }
  }

  if (signedOut) {
    return (
      <AuthCard title="Verify Your Email" subtitle="Sign in first, so we know which address to verify." backHref="/sign-in">
        <GradientButton href="/sign-in">Go to Sign In</GradientButton>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Verify Your Email"
      subtitle={email ? `We have sent a ${CODE_LENGTH}-digit code to ${email}` : "Sending your code…"}
    >
      <OtpInput length={CODE_LENGTH} value={code} onChange={setCode} />

      <p className="mt-4 text-center text-[13px] text-slate-500">
        Didn&apos;t receive the code?{" "}
        {secondsLeft > 0 ? (
          <span className="tabular font-semibold text-brand-navy">
            Resend in 00:{String(secondsLeft).padStart(2, "0")}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCode(Array(CODE_LENGTH).fill(""));
              void send();
            }}
            className="font-semibold text-brand-magenta hover:underline"
          >
            Resend code
          </button>
        )}
      </p>

      <div className="mt-4 space-y-3">
        {error && <Problem>{error}</Problem>}
        <MailNote mail={mail} />
      </div>

      <div className="mt-5">
        <GradientButton onClick={() => void verify()} disabled={!complete || submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              Verifying&hellip;
            </>
          ) : (
            <>Verify &amp; Continue</>
          )}
        </GradientButton>
      </div>

      <p className="mt-3 text-center">
        <Link href={destination} className="text-[13px] font-semibold text-slate-500 hover:text-brand-navy">
          Do this later
        </Link>
      </p>

      <div className="mt-5 flex flex-col items-center">
        {illustration}
        <p className="mt-3 text-[14px] font-bold text-brand-navy">Almost there!</p>
        <p className="text-[13px] text-slate-500">The code expires in 15 minutes.</p>
      </div>
    </AuthCard>
  );
}

// ── accept an invitation ────────────────────────────────────────────────────────────

/**
 * Feature List §12 — the invitee's side of "Invite members by email with a pre-set role".
 * The account is created here, with a password only its owner chooses, and signed in.
 */
export function AcceptInviteScreen({ token }: { token: string }) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [invalid, setInvalid] = useState(!token);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    authApi.previewInvitation(token).then(
      (preview) => {
        setInvitation(preview);
        setName(preview.name ?? "");
      },
      () => setInvalid(true),
    );
  }, [token]);

  if (invalid) {
    return (
      <AuthCard title="Invitation Unavailable" backHref="/sign-in">
        <div className="space-y-4">
          <Problem>
            This invitation has expired, was withdrawn, or has already been used. Ask the person who invited you
            to send a new one.
          </Problem>
          <GradientButton href="/sign-in">Go to Sign In</GradientButton>
        </div>
      </AuthCard>
    );
  }

  if (!invitation) {
    return (
      <AuthCard title="Joining your team">
        <p className="flex items-center justify-center gap-2 py-6 text-[13px] text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
          Opening your invitation&hellip;
        </p>
      </AuthCard>
    );
  }

  const role = invitation.role.charAt(0) + invitation.role.slice(1).toLowerCase();
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    name.trim().length >= 2 &&
    password.length >= MIN_PASSWORD &&
    passwordScore(password) >= 3 &&
    confirm === password &&
    !submitting;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.acceptInvitation({ token, name: name.trim(), password });
      router.push("/");
      router.refresh();
    } catch (cause) {
      setError(messageOf(cause));
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title={`Join ${invitation.workspace.name}`}
      subtitle={`${invitation.invitedBy ? `${invitation.invitedBy} invited you` : "You have been invited"} to join as ${role}.`}
      footer={
        <>
          Already have an account here? <Link href="/sign-in" className="font-semibold text-brand-magenta hover:underline">Sign In</Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="rounded-btn border border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <p className="text-[10.5px] font-medium text-slate-400">Email</p>
          <p className="truncate text-[14px] text-brand-navy">{invitation.email}</p>
        </div>
        <Field label="Full Name" icon="user" autoComplete="name" value={name} onChange={setName} />
        <div>
          <Field
            label="Create Password"
            icon="lock"
            type="password"
            placeholder={`At least ${MIN_PASSWORD} characters`}
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
          <PasswordStrength password={password} />
        </div>
        <div>
          <Field
            label="Confirm Password"
            icon="lock"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
          {mismatch && <p className="mt-1.5 text-[12px] font-medium text-alert-red">Both passwords must match.</p>}
        </div>
        {error && <Problem>{error}</Problem>}
        <GradientButton type="submit" disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              Creating your account&hellip;
            </>
          ) : (
            "Accept & Join"
          )}
        </GradientButton>
        <p className="text-center text-[11.5px] text-slate-400">
          Workspace: <span className="font-mono">{invitation.workspace.subdomain}</span> — you sign in with this.
        </p>
      </form>
    </AuthCard>
  );
}
