import type { Metadata } from "next";
import { AuthCard, AuthLink } from "@/components/auth/auth-ui";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Create Account · Appsgain" };

/** Feature List §1 — Authentication. */
export default function SignUpPage() {
  return (
    <AuthCard
      title="Create Your Account"
      subtitle="Get started with AI calling for your business"
      backHref="/sign-in"
      footer={
        <>
          Already have an account? <AuthLink href="/sign-in">Sign In</AuthLink>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
