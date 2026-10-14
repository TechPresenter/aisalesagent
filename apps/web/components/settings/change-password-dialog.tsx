"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { PasswordStrength } from "@/components/auth/auth-ui";
import { ApiError, authApi } from "@/lib/api-client";

/** The API's floor (ChangePasswordDto). Checked here only to say so before submitting. */
const MIN_PASSWORD = 12;

const FIELD =
  "h-11 w-full rounded-btn border border-slate-200 px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

/**
 * Changes the signed-in user's own password — or, for an account that signed up with
 * Google or Microsoft and has none, sets its first one.
 *
 * The current password is asked for because the server asks for it — holding a session is
 * not proof of knowing the password, and a password change hands over the account.
 *
 * On success the server revokes every session, this one included, so the dialog signs out
 * and sends the user to sign in again rather than leaving a shell whose next request 401s.
 *
 * A first password has no current one to ask for. The server takes it only soon after a
 * sign-in instead, and keeps the sessions, so the dialog just closes and the person
 * carries on — typically to turn on two-factor authentication, which needs a password.
 */
export function ChangePasswordDialog({
  open,
  onClose,
  onPasswordSet,
}: {
  open: boolean;
  onClose: () => void;
  /** After a first password was set, which leaves the person signed in. */
  onPasswordSet?: () => void;
}) {
  const router = useRouter();
  // Null until the server has said whether there is a password to change.
  const [mode, setMode] = useState<"change" | "set" | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setMode(null);

    let live = true;
    authApi.security().then(
      (overview) => {
        if (live) setMode(overview.hasPassword ? "change" : "set");
      },
      // Not knowing is no reason to hold up the usual form; the server says if it is wrong.
      () => {
        if (live) setMode("change");
      },
    );
    return () => {
      live = false;
    };
  }, [open]);

  const setting = mode === "set";
  const mismatch = confirm.length > 0 && next !== confirm;
  const valid =
    mode !== null &&
    (setting || current.length > 0) &&
    next.length >= MIN_PASSWORD &&
    next === confirm &&
    (setting || next !== current);

  async function submit() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      if (setting) await authApi.setPassword({ newPassword: next });
      else await authApi.changePassword({ currentPassword: current, newPassword: next });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status < 500
          ? cause.message
          : "Could not reach the server. Try again.",
      );
      setSaving(false);
      return;
    }

    if (setting) {
      setSaving(false);
      onPasswordSet?.();
      onClose();
      return;
    }

    // Every session is gone, so clear this one's tokens too and start again at sign-in.
    await authApi.logout().catch(() => undefined);
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={setting ? "Set a password" : "Change password"}
      description={
        setting
          ? "You sign in with Google or Microsoft. A password lets you sign in with your email too, and is needed to turn on two-factor authentication."
          : "You will be signed out everywhere and asked to sign in again."
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || saving}
            className="inline-flex h-10 items-center gap-2 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
            {setting ? "Set password" : "Change password"}
          </button>
        </>
      }
    >
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-btn bg-alert-red/[0.09] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
        >
          {error}
        </p>
      )}

      {mode === null ? (
        <p className="text-[13px] text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          {!setting && (
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                Current password
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                className={FIELD}
              />
            </label>
          )}

          <div>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                New password{" "}
                <span className="text-slate-400">(at least {MIN_PASSWORD} characters)</span>
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                className={FIELD}
              />
            </label>
            <PasswordStrength password={next} />
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
              Confirm new password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={FIELD}
            />
            {mismatch && (
              <span className="mt-1 block text-[11.5px] text-[#C93B3B]">
                The two new passwords do not match.
              </span>
            )}
          </label>
        </div>
      )}
    </Modal>
  );
}
