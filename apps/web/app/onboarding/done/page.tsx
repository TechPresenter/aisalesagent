import type { Metadata } from "next";
import { SuccessScreen } from "@/components/auth/success-screen";
import { appBrand } from "@/config/app-brand";

export const metadata: Metadata = { title: `Welcome · ${appBrand.name}` };

/** Feature List §1 — Onboarding, final step. */
export default function OnboardingDonePage() {
  return (
    <SuccessScreen
      title="Welcome to Appsgain!"
      body="Your account is ready. Let's start growing your business with AI."
      action="Go to Dashboard"
      href="/"
    />
  );
}
