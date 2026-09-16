import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-ui";
import { OnboardingBusinessForm } from "@/components/auth/onboarding-business-form";

export const metadata: Metadata = { title: "Your Business · Appsgain" };

/** Feature List §1 — Onboarding, step two: what the workspace is called and what it does. */
export default function OnboardingBusinessPage() {
  return (
    <AuthCard
      title="Tell us about your business"
      subtitle="Set up your organization details."
      backHref="/onboarding/role"
    >
      <OnboardingBusinessForm />
    </AuthCard>
  );
}
