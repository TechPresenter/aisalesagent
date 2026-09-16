import type { Metadata } from "next";
import { AuthCard, Field, GradientButton } from "@/components/auth/auth-ui";

export const metadata: Metadata = { title: "Forgot Password · Appsgain" };

/** Feature List §1 — Authentication. Password reset, step one. */
export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot Password?"
      subtitle="Enter your email address and we'll send you a link to reset your password."
      backHref="/sign-in"
    >
      <form action="/reset-password" className="space-y-4">
        <Field
          label="Email"
          icon="mail"
          type="email"
          placeholder="you@yourcompany.com"
          autoComplete="email"
        />
        <GradientButton type="submit">Send Reset Link</GradientButton>
      </form>

      <div className="mt-7 flex flex-col items-center text-center">
        <MailKeyIllustration />
        <p className="mt-3 text-[14px] font-bold text-brand-navy">Check your inbox</p>
        <p className="mt-0.5 max-w-[280px] text-[13px] leading-relaxed text-slate-500">
          We&apos;ll send you a password reset link shortly.
        </p>
      </div>
    </AuthCard>
  );
}

/** Envelope with a key seal — the reset-link spot illustration. */
function MailKeyIllustration() {
  return (
    <svg width="164" height="96" viewBox="0 0 164 96" fill="none" aria-hidden>
      <defs>
        <linearGradient id="reset-key" x1="96" y1="8" x2="128" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F7671E" />
          <stop offset="1" stopColor="#E5199B" />
        </linearGradient>
        <linearGradient id="reset-hill" x1="0" y1="60" x2="164" y2="96" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F7671E" stopOpacity="0.1" />
          <stop offset="1" stopColor="#9333EA" stopOpacity="0.13" />
        </linearGradient>
      </defs>

      <path d="M0 96c24-30 44-24 64-10s36 16 56-8 34-16 44-4v22H0Z" fill="url(#reset-hill)" />

      <rect x="30" y="30" width="70" height="46" rx="6" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <path d="M30 37l35 24 35-24" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Motion ticks, echoing the "link is on its way" of the copy. */}
      <path d="M118 30h14M124 40h14M128 20h12" stroke="#9333EA" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" />

      <circle cx="104" cy="26" r="17" fill="url(#reset-key)" />
      <circle cx="104" cy="21" r="4.5" stroke="#FFFFFF" strokeWidth="2.6" />
      <path d="M104 25.5v9M104 31h4" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
