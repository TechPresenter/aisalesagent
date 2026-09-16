"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, KeyRound, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { API_BASE_URL, apiKeysApi, type ApiKeyInfo, type ApiKeyScopeInfo } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import { CopyButton, INPUT, SecretDialog, messageOf, timeAgo, useTwoStep } from "./shared";

const EXPIRY_OPTIONS = [
  { value: "", label: "Never" },
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "180", label: "In 180 days" },
  { value: "365", label: "In a year" },
];

const STATUS_TONE: Record<ApiKeyInfo["status"], "green" | "amber" | "gray"> = {
  ACTIVE: "green",
  EXPIRED: "amber",
  REVOKED: "gray",
};

/**
 * Settings → Integrations → API keys: access to the REST API for a workspace's own
 * software. A key does what its scopes allow and never more than the person who made it,
 * and revoking one takes effect on its next request.
 */
export function ApiKeysPanel({
  canManage,
  onNotice,
  onError,
}: {
  canManage: boolean;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [scopes, setScopes] = useState<ApiKeyScopeInfo[]>([]);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useTwoStep();

  const load = useCallback(() => {
    apiKeysApi.list().then(
      (result) => {
        setKeys(result.keys);
        setScopes(result.scopes);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    if (canManage) load();
  }, [canManage, load]);

  const closeCreate = useCallback(() => setCreating(false), []);
  const closeSecret = useCallback(() => setSecret(null), []);

  if (!canManage) {
    return (
      <Card className="p-5">
        <CardTitle>API keys</CardTitle>
        <p className="mt-2 text-[13px] text-slate-500">
          Managing API keys needs the API keys permission, which starts at the Admin role.
        </p>
      </Card>
    );
  }

  const labelOf = (key: string) => scopes.find((scope) => scope.key === key)?.label ?? key;
  const example = `curl "${API_BASE_URL}/api/leads?pageSize=5" \\\n  -H "X-API-Key: agk_your_key_here"`;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader className="p-0">
          <div className="min-w-0">
            <CardTitle>API keys</CardTitle>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              Let your own software read and write Appsgain data through the REST API. A key can
              only do what its scopes allow, and never more than the person who created it.
            </p>
          </div>
          <Button className="h-10 shrink-0" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            Create key
          </Button>
        </CardHeader>

        {failed ? (
          <p className="mt-4 text-[13px] text-slate-500">Could not load API keys.</p>
        ) : !keys ? (
          <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
        ) : keys.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <KeyRound className="mx-auto h-5 w-5 text-slate-300" strokeWidth={2} />
            <p className="mt-2 text-[13.5px] font-semibold text-brand-navy">No API keys yet</p>
            <p className="mt-1 text-[12.5px] text-slate-500">Create one for each system that needs access.</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {keys.map((key) => (
              <li key={key.id} className={cn("p-3.5", key.status !== "ACTIVE" && "bg-slate-50/60")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-brand-navy">
                      {key.name}
                      <Badge tone={STATUS_TONE[key.status]}>
                        {key.status.charAt(0) + key.status.slice(1).toLowerCase()}
                      </Badge>
                    </p>
                    <p className="mt-0.5 font-mono text-[12px] text-slate-500">{key.prefix}••••••••</p>
                  </div>
                  {key.status === "ACTIVE" && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        if (armed !== key.id) {
                          setArmed(key.id);
                          return;
                        }
                        setArmed(null);
                        setBusy(key.id);
                        apiKeysApi
                          .revoke(key.id)
                          .then(
                            () => {
                              onNotice(`“${key.name}” revoked. It stops working on its next request.`);
                              load();
                            },
                            (cause) => onError(messageOf(cause)),
                          )
                          .then(() => setBusy(null));
                      }}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-btn border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50",
                        armed === key.id
                          ? "border-alert-red bg-alert-red text-white"
                          : "border-alert-red/40 text-alert-red hover:bg-alert-red/[0.06]",
                      )}
                    >
                      {busy === key.id && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />}
                      {armed === key.id ? "Confirm revoke" : "Revoke"}
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {key.scopes.map((scope) => (
                    <span key={scope} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-600">
                      {labelOf(scope)}
                    </span>
                  ))}
                </div>
                <p className="tabular mt-2 text-[11.5px] text-slate-400">
                  Created {formatDate(key.createdAt)}
                  {key.createdBy ? ` by ${key.createdBy.name}` : ""} · Last used {timeAgo(key.lastUsedAt)}
                  {key.revokedAt
                    ? ` · Revoked ${formatDate(key.revokedAt)}`
                    : key.expiresAt
                      ? ` · ${key.status === "EXPIRED" ? "Expired" : "Expires"} ${formatDate(key.expiresAt)}`
                      : " · Never expires"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle>Using a key</CardTitle>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">
          Send it as <code className="rounded bg-slate-100 px-1 font-mono text-[11.5px]">X-API-Key</code>, or as{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-[11.5px]">Authorization: Bearer agk_…</code>. Keys
          work on the same endpoints the app uses, limited to their scopes; account, team and settings endpoints refuse
          them. Keep keys on servers — never in a browser or a mobile app.
        </p>
        <div className="relative mt-3">
          <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-brand-navy p-3.5 pr-24 font-mono text-[11.5px] leading-relaxed text-slate-100">
            {example}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyButton value={example} />
          </div>
        </div>
      </Card>

      <CreateKeyDialog
        open={creating}
        scopes={scopes}
        onClose={closeCreate}
        onCreated={(created) => {
          setCreating(false);
          setSecret(created.secret);
          load();
        }}
      />

      {secret && (
        <SecretDialog
          open
          title="API key created"
          description="Use it from your server as the X-API-Key header."
          secret={secret}
          onClose={closeSecret}
        />
      )}
    </div>
  );
}

function CreateKeyDialog({
  open,
  scopes,
  onClose,
  onCreated,
}: {
  open: boolean;
  scopes: ApiKeyScopeInfo[];
  onClose: () => void;
  onCreated: (created: { key: ApiKeyInfo; secret: string }) => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>(["leads.view"]);
  const [expiry, setExpiry] = useState("90");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setSelected(["leads.view"]);
    setExpiry("90");
    setError(null);
  }, [open]);

  async function submit() {
    if (name.trim().length < 2) {
      setError("Give the key a name, so you know what it is for when it is time to revoke it.");
      return;
    }
    if (selected.length === 0) {
      setError("Pick at least one scope.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onCreated(
        await apiKeysApi.create({
          name: name.trim(),
          scopes: selected,
          ...(expiry ? { expiresInDays: Number(expiry) } : {}),
        }),
      );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create API key"
      description="Give a key only the access its system needs."
      footer={
        <>
          <Button variant="secondary" className="h-10" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="h-10 bg-accent-blue hover:bg-[#1B6CD8]" onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
            Create key
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">
              Name<span className="ml-0.5 text-alert-red">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Website contact form"
              maxLength={60}
              className={INPUT}
              disabled={saving}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">Expires</span>
            <select value={expiry} onChange={(event) => setExpiry(event.target.value)} className={INPUT} disabled={saving}>
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-semibold text-slate-600">Scopes</legend>
          <div className="grid grid-cols-1 gap-x-3 rounded-lg border border-slate-200 p-1.5 sm:grid-cols-2">
            {scopes.map((scope) => {
              const on = selected.indexOf(scope.key) >= 0;
              return (
                <label
                  key={scope.key}
                  title={scope.grantable ? undefined : "Your role does not have this access, so a key cannot either."}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-2",
                    scope.grantable ? "cursor-pointer hover:bg-slate-50" : "cursor-not-allowed opacity-50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!scope.grantable || saving}
                    onChange={() =>
                      setSelected(on ? selected.filter((key) => key !== scope.key) : selected.concat(scope.key))
                    }
                    className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-[#19B969]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-brand-navy">{scope.label}</span>
                    <code className="block font-mono text-[11px] text-slate-400">{scope.key}</code>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-alert-red/[0.08] p-3 text-[12.5px] text-[#C93B3B]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
