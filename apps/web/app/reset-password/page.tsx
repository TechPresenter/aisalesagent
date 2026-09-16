"use client";

import { useState } from "react";
import {
  AuthCard,
  Field,
  GradientButton,
  PasswordStrength,
  passwordScore,
} from "@/components/auth/auth-ui";

/** Feature List §1 — Authentication. Password reset, step two. */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm.length > 0 && confirm !== password;
  // Weak passwords are the whole reason the meter is on screen, so the button waits for
  // one that clears it — and for the two fields to actually agree.
  const canSubmit = passwordScore(password) >= 3 && confirm === password && password.length > 0;

  return (
    <AuthCard
      title="Reset Your Password"
      subtitle="Create a new password for your account."
      backHref="/forgot-password"
    >
      <div className="space-y-4">
        <div>
          <Field
            label="New Password"
            icon="lock"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <PasswordStrength password={password} />
        </div>

        <div>
          <Field
            label="Confirm New Password"
            icon="lock"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
          {mismatch && (
            <p role="alert" className="mt-1.5 text-[12px] font-medium text-alert-red">
              Both passwords must match.
            </p>
          )}
        </div>

        <GradientButton href="/reset-password/success" disabled={!canSubmit}>
          Reset Password
        </GradientButton>
      </div>
    </AuthCard>
  );
}
