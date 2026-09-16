import type { Metadata } from "next";
import { AuthCard, AuthLink } from "@/components/auth/auth-ui";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign In · Appsgain" };

/** Feature List §1 — Authentication. */
export default function SignInPage() {
  return (
    <AuthCard
      title="Welcome Back"
      subtitle="Sign in to your account to continue"
      backHref="/welcome"
      footer={
        <>
          Don&apos;t have an account? <AuthLink href="/sign-up">Sign Up</AuthLink>
        </>
      }
    >
      <SignInForm />

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
          Or continue with
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SsoButton provider="Google" />
        <SsoButton provider="Microsoft" />
      </div>
    </AuthCard>
  );
}

/**
 * TRD §5 lists Google and Microsoft SSO. The marks are drawn inline rather than fetched:
 * both vendors' brand guidelines require the exact logo, and a remote image that fails
 * to load leaves an unlabelled button.
 *
 * Disabled until the API has an OAuth flow to send them to — a sign-in button that does
 * nothing when pressed reads as a broken page, not as a feature still to come.
 */
function SsoButton({ provider }: { provider: "Google" | "Microsoft" }) {
  return (
    <button
      type="button"
      disabled
      title={`${provider} sign-in is not set up yet.`}
      className="flex h-12 cursor-not-allowed items-center justify-center gap-2.5 rounded-btn border border-slate-200 bg-surface text-[14px] font-semibold text-brand-navy opacity-60"
    >
      {provider === "Google" ? <GoogleMark /> : <MicrosoftMark />}
      {provider}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1Z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.6-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M11.6 28.1a13.2 13.2 0 0 1 0-8.2v-5.7H4.3a22 22 0 0 0 0 19.6l7.3-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 9.5c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 2.9 30 1 24 1 15.4 1 7.9 5.9 4.3 13.2l7.3 5.7C13.4 13.4 18.2 9.5 24 9.5Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M1 1h10.2v10.2H1z" />
      <path fill="#7FBA00" d="M12.8 1H23v10.2H12.8z" />
      <path fill="#00A4EF" d="M1 12.8h10.2V23H1z" />
      <path fill="#FFB900" d="M12.8 12.8H23V23H12.8z" />
    </svg>
  );
}
