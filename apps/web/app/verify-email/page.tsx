import type { Metadata } from "next";
import { VerifyEmailScreen } from "@/components/auth/recovery-forms";

export const metadata: Metadata = { title: "Verify Email · Appsgain" };

/**
 * Feature List §1 — Authentication. Email verification for the signed-in account.
 * `?next=` is where to go afterwards: onboarding after sign-up, Settings after a reminder.
 */
export default function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const next = Array.isArray(searchParams.next) ? searchParams.next[0] : searchParams.next;
  return <VerifyEmailScreen next={next ?? "/"} illustration={<EnvelopeIllustration />} />;
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
