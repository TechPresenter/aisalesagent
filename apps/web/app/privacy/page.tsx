import type { Metadata } from "next";
import { AuthCard, AuthLink } from "@/components/auth/auth-ui";

export const metadata: Metadata = { title: "Privacy Policy · Appsgain" };

/**
 * A placeholder, deliberately not a legal document — the counterpart to /terms. The
 * sign-up form links here, so it has to exist; what it must not do is invent a policy
 * about how a workspace's lead data is handled. Replace it with the real one.
 */
export default function PrivacyPage() {
  return (
    <AuthCard
      title="Privacy Policy"
      subtitle="Not published yet."
      backHref="/sign-up"
      footer={
        <>
          Back to <AuthLink href="/sign-up">create your account</AuthLink>
        </>
      }
    >
      <div className="space-y-3 text-[13.5px] leading-relaxed text-slate-600">
        <p>
          Appsgain has not published its privacy policy yet. This page exists so the link on the
          sign-up form leads somewhere honest rather than to a missing page.
        </p>
        <p>
          The platform stores the leads, calls, recordings and transcripts a workspace creates.
          Ask whoever set up your workspace how that data is handled and for how long it is kept.
        </p>
      </div>
    </AuthCard>
  );
}
