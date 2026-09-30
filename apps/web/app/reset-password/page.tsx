import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-ui";
import { ResetPasswordForm } from "@/components/auth/recovery-forms";

export const metadata: Metadata = { title: "Reset Password · Appsgain" };

/**
 * Feature List §1 — Authentication. Password reset, step two. `?token=` comes from the
 * emailed link.
 */
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const token = Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;

  return (
    <AuthCard
      title="Reset Your Password"
      subtitle="Create a new password for your account."
      backHref="/forgot-password"
    >
      <ResetPasswordForm token={token ?? ""} />
    </AuthCard>
  );
}
