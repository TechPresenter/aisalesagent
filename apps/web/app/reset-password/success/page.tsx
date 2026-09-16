import type { Metadata } from "next";
import { SuccessScreen } from "@/components/auth/success-screen";

export const metadata: Metadata = { title: "Password Reset · Appsgain" };

/** Feature List §1 — Authentication. Password reset, step three. */
export default function ResetPasswordSuccessPage() {
  return (
    <SuccessScreen
      title="Password Reset Successful!"
      body="Your password has been updated. You can now sign in with your new password."
      action="Go to Sign In"
      href="/sign-in"
    />
  );
}
