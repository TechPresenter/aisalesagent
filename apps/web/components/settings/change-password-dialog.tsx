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
 * Changes the signed-in user's own password.
 *
 * The current password is asked for because the server asks for it — holding a session is
 * not proof of knowing the password, and a password change hands over the account.
 *
 * On success the server revokes every session, this one included, so the dialog signs out
 * and sends the user to sign in again rather than leaving a shell whose next request 401s.
 */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
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
  }, [open]);

  const mismatch = confirm.length > 0 && next !== confirm;
  const valid =
    current.length > 0 && next.length >= MIN_PASSWORD && next === confirm && next !== current;

  async function submit() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await authApi.changePassword({ currentPassword: current, newPassword: next });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status < 500
          ? cause.message
          : "Could not reach the server. Try again.",
      );
      setSaving(false);
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
      title="Change password"
      description="You will be signed out everywhere and asked to sign in again."
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
            Change password
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

      <div className="space-y-4">
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

        <div>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
              New password <span className="text-slate-400">(at least {MIN_PASSWORD} characters)</span>
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
    </Modal>
  );
}
