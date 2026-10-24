import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-ui";
import { OnboardingBusinessForm } from "@/components/auth/onboarding-business-form";

export const metadata: Metadata = { title: "Your Business · Appsgain" };

/**
 * Feature List §1 — Onboarding: what the workspace is called and what it does.
 *
 * The first onboarding step. A role picker used to come before it, but its answer was
 * thrown away — the person who signs up is the workspace's owner, and everyone else's role
 * is set when they are invited — so it is gone. There is no back link: the workspace was
 * created at sign-up, and there is nothing earlier in this flow to go back to.
 */
export default function OnboardingBusinessPage() {
  return (
    <AuthCard title="Tell us about your business" subtitle="Set up your organization details.">
      <OnboardingBusinessForm />
    </AuthCard>
  );
}
