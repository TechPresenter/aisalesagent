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
    </AuthCard>
  );
}
