"use client";

import { useEffect, useState } from "react";
import { AuthCard, GradientButton, OtpInput } from "@/components/auth/auth-ui";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 25;

/**
 * Feature List §1 — Authentication. Email verification.
 *
 * The address is hard-coded here because there is no session to read it from yet; once
 * `POST /auth/register` returns, it comes back with the pending registration.
 */
const PENDING_EMAIL = "you@yourcompany.com";

export default function VerifyEmailPage() {
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  // One interval for the whole countdown, cleared on unmount — a per-second timeout
  // chain would keep firing if the user leaves mid-count.
  useEffect(() => {
    if (secondsLeft === 0) return;
    const timer = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const complete = code.every((digit) => digit !== "");

  return (
    <AuthCard
      title="Verify Your Email"
      subtitle={`We have sent a ${CODE_LENGTH}-digit code to ${PENDING_EMAIL}`}
      backHref="/sign-up"
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
              setSecondsLeft(RESEND_SECONDS);
              setCode(Array(CODE_LENGTH).fill(""));
            }}
            className="font-semibold text-brand-magenta hover:underline"
          >
            Resend code
          </button>
        )}
      </p>

      <div className="mt-5">
        {/* Disabled until all six boxes are filled: the button is the only feedback the
            screen gives, so it should not offer to submit an incomplete code. */}
        <GradientButton href="/onboarding/role" disabled={!complete}>
          Verify &amp; Continue
        </GradientButton>
      </div>

      <div className="mt-6 flex flex-col items-center">
        <EnvelopeIllustration />
        <p className="mt-3 text-[14px] font-bold text-brand-navy">Almost there!</p>
        <p className="text-[13px] text-slate-500">Let&apos;s get you started.</p>
      </div>
    </AuthCard>
  );
}

/** The paper-plane-and-envelope spot illustration under the form. */
function EnvelopeIllustration() {
  return (
    <svg width="150" height="86" viewBox="0 0 150 86" fill="none" aria-hidden>
      <defs>
        <linearGradient id="verify-plane" x1="96" y1="12" x2="126" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F7671E" />
          <stop offset="1" stopColor="#E5199B" />
        </linearGradient>
        <linearGradient id="verify-hill" x1="0" y1="56" x2="150" y2="86" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F7671E" stopOpacity="0.12" />
          <stop offset="1" stopColor="#9333EA" stopOpacity="0.14" />
        </linearGradient>
      </defs>

      <path d="M0 86c22-26 40-22 58-10s34 14 52-6 30-16 40-6v22H0Z" fill="url(#verify-hill)" />

      <rect x="34" y="30" width="62" height="42" rx="6" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <path d="M34 37l31 21 31-21" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      <path d="M104 10 132 22l-24 8-2 14-8-14-10-4 16-16Z" fill="url(#verify-plane)" />
      <path d="M104 10 106 44" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1.5" />
    </svg>
  );
}
