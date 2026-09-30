"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toDataURL } from "qrcode";
import { CircleAlert, Download, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CopyButton, INPUT } from "@/components/settings/integrations/shared";
import { ApiError, authApi, type SecurityOverview } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";

type Dialog = "enable" | "disable" | "codes" | null;

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : "Could not reach the server. Try again.";
}

/**
 * Settings → Security: the email address's verification, and two-factor authentication.
 *
 * Every 2FA change asks for the password first, because the server does: a session left
 * open on someone else's desk should not be enough to add their phone to this account, or
 * to take the second factor away.
 */
export function AccountSecurityCards() {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    authApi.security().then(
      (result) => {
        setOverview(result);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => load(), [load]);

  const close = useCallback(() => {
    setDialog(null);
    load();
  }, [load]);

  const twoFactor = overview?.twoFactor;
  const fewCodes = twoFactor?.enabled && twoFactor.backupCodesRemaining <= 3;
  const verifyHref = `/verify-email?next=${encodeURIComponent("/settings?tab=security")}`;

  return (
    <>
      <Card className="p-5">
        <CardHeader className="p-0">
          <CardTitle>Email address</CardTitle>
          {overview && (
            <Badge tone={overview.emailVerified ? "green" : "amber"}>
              {overview.emailVerified ? "Verified" : "Not verified"}
            </Badge>
          )}
        </CardHeader>
        {failed ? (
          <p className="mt-3 text-[13px] text-slate-500">Could not load your security settings.</p>
        ) : !overview ? (
          <p className="mt-3 text-[13px] text-slate-400">Loading…</p>
        ) : overview.emailVerified ? (
          <p className="mt-1 flex items-center gap-2 text-[13px] text-slate-500">
            <MailCheck className="h-4 w-4 text-brand-green" strokeWidth={2} />
            Password resets and security notices can reach you.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] leading-relaxed text-slate-500">
              Confirm your address with a six-digit code, so password resets and security notices reach you.
            </p>
            <Link
              href={verifyHref}
              className="inline-flex h-10 shrink-0 items-center rounded-btn border border-slate-300 px-4 text-[13px] font-semibold text-brand-navy hover:bg-slate-50"
            >
              Verify email
            </Link>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <CardHeader className="p-0">
          <CardTitle>Two-factor authentication</CardTitle>
          {twoFactor && <Badge tone={twoFactor.enabled ? "green" : "gray"}>{twoFactor.enabled ? "On" : "Off"}</Badge>}
        </CardHeader>

        {notice && (
          <p role="status" className="mt-3 rounded-btn bg-brand-green/[0.1] px-3 py-2 text-[12.5px] font-medium text-deep-green">
            {notice}
          </p>
        )}

        {failed ? (
          <p className="mt-3 text-[13px] text-slate-500">Could not load your security settings.</p>
        ) : !twoFactor ? (
          <p className="mt-3 text-[13px] text-slate-400">Loading…</p>
        ) : twoFactor.enabled ? (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              On since {twoFactor.enabledAt ? formatDate(twoFactor.enabledAt) : "recently"}. Signing in needs a code
              from your authenticator app.{" "}
              <span className={cn(fewCodes && "font-semibold text-[#B4761A]")}>
                {twoFactor.backupCodesRemaining} backup {twoFactor.backupCodesRemaining === 1 ? "code" : "codes"} left.
              </span>
            </p>
            {fewCodes && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-warning-amber/[0.12] p-3 text-[12.5px] text-[#8A5A12]">
                <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2.2} />
                Running low on backup codes. Make new ones before you need one.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Button variant="secondary" className="h-10" onClick={() => setDialog("codes")}>
                New backup codes
              </Button>
              <Button
                variant="secondary"
                className="h-10 border-alert-red/40 text-alert-red hover:bg-alert-red/[0.06]"
                onClick={() => setDialog("disable")}
              >
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              Add a second step to signing in: a six-digit code from an authenticator app such as Google Authenticator,
              Microsoft Authenticator or 1Password. A stolen password alone is then not enough.
            </p>
            <div className="mt-4">
              <Button className="h-10 bg-accent-blue hover:bg-[#1B6CD8]" onClick={() => setDialog("enable")}>
                <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
                Turn on two-factor authentication
              </Button>
            </div>
          </>
        )}
      </Card>

      <EnableTwoFactorDialog
        open={dialog === "enable"}
        onClose={close}
        onDone={() => setNotice("Two-factor authentication is on. Keep your backup codes somewhere safe.")}
      />
      <ConfirmWithCodeDialog
        open={dialog === "disable"}
        mode="disable"
        onClose={close}
        onDone={() => setNotice("Two-factor authentication is off.")}
      />
      <ConfirmWithCodeDialog
        open={dialog === "codes"}
        mode="codes"
        onClose={close}
        onDone={() => setNotice("New backup codes made. The old ones no longer work.")}
      />
    </>
  );
}

/** A code field that takes an authenticator code or a backup code. */
function CodeInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      inputMode="text"
      autoComplete="one-time-code"
      placeholder="123456 or xxxx-xxxx"
      aria-label="Authentication code"
      className={cn(INPUT, "text-center font-mono tracking-[0.15em]")}
    />
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  const text = `Appsgain backup codes — each works once\n\n${codes.join("\n")}\n`;
  return (
    <div>
      <p className="rounded-lg bg-warning-amber/[0.12] p-3 text-[12.5px] leading-relaxed text-[#8A5A12]">
        Save these now. Each one signs you in once if you lose your phone, and they will not be shown again.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3">
        {codes.map((code) => (
          <li key={code} className="text-center font-mono text-[14px] font-semibold tracking-wider text-brand-navy">
            {code}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton value={text} label="Copy codes" />
        <button
          type="button"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "appsgain-backup-codes.txt";
            link.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-[12.5px] font-semibold text-brand-navy hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
          Download
        </button>
      </div>
    </div>
  );
}

function EnableTwoFactorDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<"password" | "scan" | "codes">("password");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qr: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("password");
    setPassword("");
    setSetup(null);
    setCode("");
    setCodes([]);
    setError(null);
  }, [open]);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.beginTwoFactor(password);
      setPassword("");
      const qr = await toDataURL(result.otpauthUri, { margin: 1, width: 196 }).catch(() => null);
      setSetup({ secret: result.secret, qr });
      setStep("scan");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.confirmTwoFactor(code.trim());
      setCodes(result.backupCodes);
      setStep("codes");
      onDone();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  const grouped = setup?.secret.match(/.{1,4}/g)?.join(" ") ?? "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Turn on two-factor authentication"
      description={
        step === "password"
          ? "Confirm it is you first."
          : step === "scan"
            ? "Scan the code with your authenticator app, then enter the code it shows."
            : "Two-factor authentication is on."
      }
      footer={
        step === "codes" ? (
          <Button className="h-10 bg-accent-blue hover:bg-[#1B6CD8]" onClick={onClose}>
            I have saved my codes
          </Button>
        ) : (
          <>
            <Button variant="secondary" className="h-10" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="h-10 bg-accent-blue hover:bg-[#1B6CD8]"
              disabled={busy || (step === "password" ? password.length === 0 : !/^\d{6}$/.test(code.trim()))}
              onClick={() => void (step === "password" ? begin() : confirm())}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
              {step === "password" ? "Continue" : "Turn on"}
            </Button>
          </>
        )
      }
    >
      {step === "password" && (
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">Current password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className={INPUT}
          />
        </label>
      )}

      {step === "scan" && setup && (
        <div className="space-y-3">
          <div className="flex justify-center">
            {setup.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={setup.qr} alt="QR code for your authenticator app" width={196} height={196} className="rounded-lg border border-slate-200" />
            ) : (
              <p className="text-[12.5px] text-slate-500">The QR code could not be drawn — enter the key below instead.</p>
            )}
          </div>
          <div>
            <p className="text-[12px] text-slate-500">Or enter this key by hand:</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-[13px] font-semibold text-brand-navy">
                {grouped}
              </code>
              <CopyButton value={setup.secret} />
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">6-digit code from the app</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className={cn(INPUT, "text-center font-mono text-[18px] tracking-[0.3em]")}
            />
          </label>
        </div>
      )}

      {step === "codes" && <BackupCodes codes={codes} />}

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-alert-red/[0.08] p-3 text-[12.5px] text-[#C93B3B]">
          <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}
    </Modal>
  );
}

/** Turning 2FA off, or replacing backup codes: both need the password and a current code. */
function ConfirmWithCodeDialog({
  open,
  mode,
  onClose,
  onDone,
}: {
  open: boolean;
  mode: "disable" | "codes";
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setCode("");
    setCodes(null);
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "disable") {
        await authApi.disableTwoFactor({ password, code: code.trim() });
        onDone();
        onClose();
      } else {
        const result = await authApi.regenerateBackupCodes({ password, code: code.trim() });
        setPassword("");
        setCodes(result.backupCodes);
        onDone();
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={mode === "disable" ? "Turn off two-factor authentication" : "Make new backup codes"}
      description={
        codes
          ? "Your old backup codes no longer work."
          : "Enter your password and a code from your authenticator app, or a backup code."
      }
      footer={
        codes ? (
          <Button className="h-10 bg-accent-blue hover:bg-[#1B6CD8]" onClick={onClose}>
            I have saved my codes
          </Button>
        ) : (
          <>
            <Button variant="secondary" className="h-10" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={mode === "disable" ? "danger" : "primary"}
              className={cn("h-10", mode === "codes" && "bg-accent-blue hover:bg-[#1B6CD8]")}
              disabled={busy || password.length === 0 || code.trim().length < 6}
              onClick={() => void submit()}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
              {mode === "disable" ? "Turn off" : "Make new codes"}
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <BackupCodes codes={codes} />
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">Current password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">Code</span>
            <CodeInput value={code} onChange={setCode} disabled={busy} />
          </label>
          {mode === "disable" && (
            <p className="text-[12px] leading-relaxed text-slate-500">
              Signing in will then need only your password. You will get an email saying it was turned off.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-alert-red/[0.08] p-3 text-[12.5px] text-[#C93B3B]">
          <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}
    </Modal>
  );
}
