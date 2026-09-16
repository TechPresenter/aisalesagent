"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Monitor } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiError, authApi } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

/** "Chrome on Windows" from a user-agent string, or an honest shrug. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";

  const platform = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "an unknown system";

  return `${browser} on ${platform}`;
}

/**
 * Feature List §14 — Settings → Security.
 *
 * Sessions are the refresh tokens this account holds: one row per sign-in that has not
 * been revoked or expired. The access token in the browser lives fifteen minutes, so
 * ending a session stops it at the next refresh rather than instantly — which the screen
 * says, instead of implying an immediate cut-off it cannot deliver.
 */
export function SecurityTab({ onChangePassword }: { onChangePassword: () => void }) {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    authApi.sessions().then(setSessions, () => setFailed(true));
  }, []);

  useEffect(() => load(), [load]);

  async function revoke(session: Session) {
    setBusyId(session.id);
    setNotice(null);
    try {
      await authApi.revokeSession(session.id);
      setNotice(`Signed out of ${describeDevice(session.userAgent)}.`);
      load();
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "Could not end that session.");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeAll() {
    setSigningOutAll(true);
    try {
      await authApi.revokeAllSessions();
    } catch {
      // Even a failure here should not strand someone in a shell they meant to leave.
    }
    await authApi.logout().catch(() => undefined);
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardTitle>Password</CardTitle>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          Changing your password signs you out of every device, including this one, and asks
          you to sign in again.
        </p>
        <div className="mt-4">
          <Button variant="secondary" className="h-11" onClick={onChangePassword}>
            Change Password
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader className="p-0">
          <CardTitle>Where you are signed in</CardTitle>
          {sessions && sessions.length > 0 && (
            <button
              type="button"
              onClick={() => void revokeAll()}
              disabled={signingOutAll}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-btn border border-alert-red/40 px-3 text-[12.5px] font-semibold text-alert-red transition-colors hover:bg-alert-red/[0.06] disabled:opacity-50"
            >
              {signingOutAll && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
              Sign out everywhere
            </button>
          )}
        </CardHeader>

        {notice && (
          <p
            role="status"
            className="mt-3 rounded-btn bg-brand-green/[0.1] px-3 py-2 text-[12.5px] font-medium text-deep-green"
          >
            {notice}
          </p>
        )}

        {failed ? (
          <p className="mt-4 text-[13px] text-slate-500">Could not load your sessions.</p>
        ) : !sessions ? (
          <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
            No active sessions. A session is recorded when you sign in with your password — this
            list fills in from your next sign-in.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100">
                  <Monitor className="h-4 w-4 text-slate-500" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-brand-navy">
                    {describeDevice(session.userAgent)}
                  </p>
                  <p className="tabular truncate text-[12px] text-slate-500">
                    {session.ipAddress ?? "address not recorded"} · signed in{" "}
                    {formatDateTime(session.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void revoke(session)}
                  disabled={busyId === session.id}
                  className="h-9 shrink-0 rounded-btn border border-slate-200 px-3 text-[12.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Sign out
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-500">
          Ending a session revokes its refresh token. The device keeps working until its
          current access token expires — at most fifteen minutes — and is then sent to sign-in.
        </p>
      </Card>

      <Card className="p-5">
        <CardTitle>Two-factor authentication</CardTitle>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          Not available yet. The data model has a place for it, but there is no endpoint to
          enrol a device or verify a code, so there is nothing here to switch on.
        </p>
      </Card>
    </div>
  );
}
