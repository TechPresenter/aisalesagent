"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  integrationsApi,
  type IntegrationItem,
  type IntegrationSettingsInput,
  type PlatformEventInfo,
} from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";
import {
  CopyButton,
  ConnectionBadge,
  DEFAULT_EVENTS,
  EventPicker,
  INPUT,
  IntegrationLogo,
  Toggle,
  messageOf,
  timeAgo,
  useTwoStep,
} from "./shared";

type Busy = "connect" | "save" | "test" | "disconnect" | "oauth" | null;

function initialValues(item: IntegrationItem): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of item.fields) {
    // A choice field starts on its first option; nothing secret is ever prefilled.
    values[field.key] = field.options ? field.options[0].value : "";
  }
  return values;
}

function initialEvents(item: IntegrationItem, all: PlatformEventInfo[]): string[] {
  if (item.connection) return item.connection.events;
  return DEFAULT_EVENTS[item.category] ?? all.map((event) => event.key);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key) => b.indexOf(key) >= 0);
}

/**
 * Connecting, checking and managing one integration.
 *
 * Credentials are typed here and sent once; the server checks them with the vendor before
 * keeping them, so a failure appears in this dialog — next to the field that needs fixing —
 * rather than later on a card nobody is looking at. After a successful connect the typed
 * values are cleared from memory, and what the dialog shows from then on is the server's
 * last-four preview.
 */
export function ConnectDialog({
  item,
  events,
  oauthRedirectUri,
  encryptionReady,
  canManage,
  onClose,
  onChanged,
}: {
  item: IntegrationItem | null;
  events: PlatformEventInfo[];
  oauthRedirectUri: string;
  encryptionReady: boolean;
  canManage: boolean;
  onClose: () => void;
  /** The updated catalogue entry; `connection` is null after a disconnect. */
  onChanged: (item: IntegrationItem, notice?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [syncLeads, setSyncLeads] = useState(true);
  const [syncCalendar, setSyncCalendar] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [armed, setArmed] = useTwoStep();

  // The Modal re-runs its focus trap whenever onClose changes identity, so the handler has
  // to be stable — an inline arrow would pull focus out of the field on every keystroke.
  const busyRef = useRef<Busy>(null);
  busyRef.current = busy;
  const guardedClose = useCallback(() => {
    if (busyRef.current === null) onClose();
  }, [onClose]);

  const provider = item?.provider ?? null;

  // Reset only when a different integration is opened — not when this one is saved, which
  // replaces `item` and would otherwise wipe the success message it just earned.
  useEffect(() => {
    if (!item) return;
    setValues(initialValues(item));
    setRevealed({});
    setEditing(item.connection === null);
    setSelectedEvents(initialEvents(item, events));
    setSyncLeads(item.connection?.syncLeads ?? true);
    setSyncCalendar(item.connection?.syncCalendar ?? true);
    setBusy(null);
    setError(null);
    setMessage(null);
    setArmed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const connection = item?.connection ?? null;
  const has = (feature: string) => (item ? item.features.indexOf(feature as never) >= 0 : false);

  const settingsDirty = useMemo(() => {
    if (!item || !connection) return false;
    return (
      (has("events") && !sameSet(selectedEvents, connection.events)) ||
      (has("lead_sync") && syncLeads !== (connection.syncLeads ?? true)) ||
      (has("calendar_sync") && syncCalendar !== (connection.syncCalendar ?? true))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, connection, selectedEvents, syncLeads, syncCalendar]);

  if (!item) return null;
  const current = item;

  function settingsInput(): IntegrationSettingsInput {
    return {
      ...(has("events") ? { events: selectedEvents } : {}),
      ...(has("lead_sync") ? { syncLeads } : {}),
      ...(has("calendar_sync") ? { syncCalendar } : {}),
    };
  }

  /** The same checks the server makes, so the obvious mistakes never leave the browser. */
  function problems(): string[] {
    const found: string[] = [];
    for (const field of current.fields) {
      const value = (values[field.key] ?? "").trim();
      if (!value) {
        if (!field.optional) found.push(`${field.label} is required.`);
        continue;
      }
      if (field.pattern && !new RegExp(field.pattern).test(value)) {
        found.push(field.patternMessage ? `${field.patternMessage}.` : `${field.label} is not valid.`);
      }
    }
    if (has("events") && current.category === "AUTOMATION" && selectedEvents.length === 0) {
      found.push("Pick at least one event to send.");
    }
    return found;
  }

  async function run(kind: Busy, work: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  }

  function connect() {
    const found = problems();
    if (found.length > 0) {
      setError(found.join(" "));
      return;
    }
    void run("connect", async () => {
      const credentials: Record<string, string> = {};
      for (const field of current.fields) {
        const value = (values[field.key] ?? "").trim();
        if (value) credentials[field.key] = value;
      }
      const updated = await integrationsApi.connect(current.provider, {
        credentials,
        settings: settingsInput(),
      });
      setValues(initialValues(current));
      setRevealed({});
      setEditing(false);
      onChanged(updated);
      setMessage(
        updated.connection?.verified === false
          ? `Saved. ${current.name} offers no way to check credentials, so they are stored unverified.`
          : current.auth === "webhook_url"
            ? `Connected — ${current.name} accepted the test ${current.category === "AUTOMATION" ? "event" : "message"}.`
            : `Connected — ${current.name} accepted the credentials.`,
      );
    });
  }

  function saveSettings() {
    if (has("events") && current.category === "AUTOMATION" && selectedEvents.length === 0) {
      setError("Pick at least one event to send.");
      return;
    }
    void run("save", async () => {
      const updated = await integrationsApi.update(current.provider, settingsInput());
      onChanged(updated);
      setMessage("Settings saved.");
    });
  }

  function test() {
    void run("test", async () => {
      const updated = await integrationsApi.test(current.provider);
      onChanged(updated);
      if (updated.connection?.status === "CONNECTED") {
        setMessage(
          current.auth === "webhook_url"
            ? `Test ${current.category === "AUTOMATION" ? "event" : "message"} delivered to ${current.name}.`
            : `Checked just now — ${current.name} is working.`,
        );
      } else {
        setError(updated.connection?.lastError ?? `${current.name} did not pass the check.`);
      }
    });
  }

  function disconnect() {
    if (armed !== "disconnect") {
      setArmed("disconnect");
      return;
    }
    setArmed(null);
    void run("disconnect", async () => {
      await integrationsApi.disconnect(current.provider);
      onChanged({ ...current, connection: null }, `${current.name} disconnected.`);
      onClose();
    });
  }

  function startOAuth() {
    void run("oauth", async () => {
      const { url } = await integrationsApi.startOAuth(current.provider);
      window.location.assign(url);
    });
  }

  const readOnly = !canManage;
  const oauth = current.auth === "oauth";
  const showForm = !oauth && (editing || connection === null);
  const locked = readOnly || busy !== null;

  const footer = readOnly ? (
    <Button variant="secondary" className="h-10" onClick={onClose}>
      Close
    </Button>
  ) : connection ? (
    <>
      <Button
        variant="secondary"
        className={cn(
          "mr-auto h-10",
          armed === "disconnect"
            ? "border-alert-red bg-alert-red text-white hover:bg-[#E14D4D]"
            : "border-alert-red/40 text-alert-red hover:bg-alert-red/[0.06]",
        )}
        onClick={disconnect}
        disabled={busy !== null}
      >
        {busy === "disconnect" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
        {armed === "disconnect" ? "Confirm disconnect" : "Disconnect"}
      </Button>
      {showForm ? (
        <>
          <Button variant="secondary" className="h-10" onClick={() => setEditing(false)} disabled={busy !== null}>
            Cancel
          </Button>
          <Button className="h-10 bg-accent-blue hover:bg-[#1B6CD8]" onClick={connect} disabled={busy !== null}>
            {busy === "connect" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
            {busy === "connect" ? `Checking with ${current.name}…` : "Save & check"}
          </Button>
        </>
      ) : (
        <>
          <Button variant="secondary" className="h-10" onClick={test} disabled={busy !== null}>
            {busy === "test" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
            {current.auth === "webhook_url" ? "Send test" : "Check connection"}
          </Button>
          {(has("events") || has("lead_sync") || has("calendar_sync")) && (
            <Button
              className="h-10 bg-accent-blue hover:bg-[#1B6CD8]"
              onClick={saveSettings}
              disabled={!settingsDirty || busy !== null}
            >
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
              Save settings
            </Button>
          )}
        </>
      )}
    </>
  ) : oauth ? (
    <Button variant="secondary" className="h-10" onClick={onClose}>
      Close
    </Button>
  ) : (
    <>
      <Button variant="secondary" className="h-10" onClick={onClose} disabled={busy !== null}>
        Cancel
      </Button>
      <Button
        className="h-10 bg-accent-blue hover:bg-[#1B6CD8]"
        onClick={connect}
        disabled={busy !== null || !encryptionReady}
      >
        {busy === "connect" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
        {busy === "connect" ? `Checking with ${current.name}…` : "Connect"}
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={guardedClose}
      title={connection ? current.name : `Connect ${current.name}`}
      description={current.description}
      footer={footer}
    >
      <div className="space-y-4">
        {/* ── status ── */}
        <div className="flex items-start gap-3">
          <IntegrationLogo name={current.name} color={current.color} large />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ConnectionBadge item={current} />
              {!connection && !(oauth && current.oauthReady === false) && (
                <span className="text-[12.5px] text-slate-500">Not connected</span>
              )}
            </div>
            {connection && (
              <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[12px] text-slate-500 sm:grid-cols-2">
                {connection.account && (
                  <div className="truncate sm:col-span-2">
                    <dt className="inline">Account: </dt>
                    <dd className="inline font-medium text-brand-navy">{connection.account}</dd>
                  </div>
                )}
                <div>
                  <dt className="inline">Connected </dt>
                  <dd className="inline">{formatDateTime(connection.connectedAt)}</dd>
                </div>
                <div>
                  <dt className="inline">Last checked </dt>
                  <dd className="inline">{timeAgo(connection.lastVerifiedAt)}</dd>
                </div>
                {current.category === "AUTOMATION" ? (
                  <div className="sm:col-span-2">
                    Deliveries are logged under <span className="font-medium text-brand-navy">Webhooks</span>.
                  </div>
                ) : (
                  current.features.length > 0 && (
                    <div>
                      <dt className="inline">Last delivery </dt>
                      <dd className="inline">{timeAgo(connection.lastSyncAt)}</dd>
                    </div>
                  )
                )}
              </dl>
            )}
          </div>
        </div>

        {connection?.lastError && (
          <p className="flex items-start gap-2 rounded-lg bg-alert-red/[0.08] p-3 text-[12.5px] leading-relaxed text-[#C93B3B]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
            <span>
              <span className="font-semibold">Last problem: </span>
              {connection.lastError}
            </span>
          </p>
        )}

        {/* ── what it does ── */}
        <section>
          <h3 className="mb-1.5 text-[12.5px] font-semibold text-slate-600">What connecting does</h3>
          <ul className="space-y-1.5">
            {current.does.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-slate-600">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" strokeWidth={2.2} />
                {line}
              </li>
            ))}
          </ul>
          {current.notYet && (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={2.2} />
              <span>
                <span className="font-semibold text-brand-navy">Not yet: </span>
                {current.notYet}
              </span>
            </p>
          )}
        </section>

        {!encryptionReady && !oauth && (
          <p className="rounded-lg bg-warning-amber/[0.12] p-3 text-[12.5px] leading-relaxed text-[#8A5A12]">
            The server has no <code className="font-mono">CREDENTIALS_ENCRYPTION_KEY</code>, so it
            refuses to store credentials. Set it on the API and restart.
          </p>
        )}

        {/* ── OAuth ── */}
        {oauth &&
          (current.oauthReady ? (
            !readOnly && (
              <section className="rounded-lg border border-slate-200 p-3.5">
                <p className="text-[12.5px] leading-relaxed text-slate-600">
                  {connection
                    ? `Signed in${connection.account ? ` as ${connection.account}` : ""}. Sign in again to switch account or renew access.`
                    : `You will be sent to ${current.name} to approve access, then brought back here.`}
                </p>
                <Button
                  className="mt-3 h-10 bg-accent-blue hover:bg-[#1B6CD8]"
                  onClick={startOAuth}
                  disabled={busy !== null || !encryptionReady}
                >
                  {busy === "oauth" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
                  {connection ? `Sign in to ${current.name} again` : `Continue with ${current.name}`}
                </Button>
              </section>
            )
          ) : (
            <section className="rounded-lg bg-slate-50 p-3.5 text-[12.5px] leading-relaxed text-slate-600">
              <p>
                Signing in with {current.name} needs an OAuth app registered by whoever runs this
                Appsgain server. Until then this integration cannot be connected.
              </p>
              {current.oauthEnv && (
                <p className="mt-2">
                  Set{" "}
                  <code className="rounded bg-white px-1 py-0.5 font-mono text-[11.5px]">
                    {current.oauthEnv.clientId}
                  </code>{" "}
                  and{" "}
                  <code className="rounded bg-white px-1 py-0.5 font-mono text-[11.5px]">
                    {current.oauthEnv.clientSecret}
                  </code>{" "}
                  on the API, and register this redirect URI with {current.name}:
                </p>
              )}
              <div className="mt-2 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-2 font-mono text-[11.5px] text-brand-navy">
                  {oauthRedirectUri}
                </code>
                <CopyButton value={oauthRedirectUri} />
              </div>
            </section>
          ))}

        {/* ── credentials ── */}
        {!oauth && connection && !showForm && (
          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-[12.5px] font-semibold text-slate-600">Stored credentials</h3>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={busy !== null}
                  className="text-[12.5px] font-semibold text-accent-blue hover:underline disabled:opacity-50"
                >
                  Replace credentials
                </button>
              )}
            </div>
            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {current.fields
                .filter((field) => connection.preview[field.key])
                .map((field) => (
                  <div key={field.key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt className="text-[12.5px] text-slate-500">{field.label}</dt>
                    <dd className="min-w-0 truncate font-mono text-[12px] text-brand-navy">
                      {field.options?.find((option) => option.value === connection.preview[field.key])
                        ?.label ?? connection.preview[field.key]}
                    </dd>
                  </div>
                ))}
            </dl>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.2} />
              Stored encrypted. Only the last four characters of secrets are ever shown.
            </p>
          </section>
        )}

        {showForm && !readOnly && (
          <section className="space-y-3">
            {connection && (
              <p className="text-[12.5px] text-slate-500">
                Enter every field again. The new credentials are checked before they replace the
                stored ones.
              </p>
            )}
            {current.fields.map((field) => {
              const id = `integration-${current.provider}-${field.key}`;
              const hidden = field.secret && !revealed[field.key];
              return (
                <label key={field.key} htmlFor={id} className="block">
                  <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">
                    {field.label}
                    {!field.optional && <span className="ml-0.5 text-alert-red">*</span>}
                    {field.optional && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
                  </span>
                  {field.options ? (
                    <select
                      id={id}
                      value={values[field.key] ?? ""}
                      disabled={locked}
                      onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                      className={INPUT}
                    >
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="relative block">
                      <input
                        id={id}
                        type={hidden ? "password" : "text"}
                        value={values[field.key] ?? ""}
                        disabled={locked}
                        placeholder={field.placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                        className={cn(INPUT, field.secret && "pr-10 font-mono text-[13px]")}
                      />
                      {field.secret && (
                        <button
                          type="button"
                          onClick={() => setRevealed({ ...revealed, [field.key]: !revealed[field.key] })}
                          aria-label={hidden ? `Show ${field.label}` : `Hide ${field.label}`}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-brand-navy"
                        >
                          {hidden ? (
                            <Eye className="h-4 w-4" strokeWidth={2} />
                          ) : (
                            <EyeOff className="h-4 w-4" strokeWidth={2} />
                          )}
                        </button>
                      )}
                    </span>
                  )}
                  {field.help && (
                    <span className="mt-1 block text-[11.5px] leading-relaxed text-slate-400">{field.help}</span>
                  )}
                </label>
              );
            })}
          </section>
        )}

        {/* ── settings ── */}
        {has("lead_sync") && (connection || showForm) && (
          <Toggle
            checked={syncLeads}
            onChange={setSyncLeads}
            disabled={locked}
            label="Sync new leads"
            description={`Create a record in ${current.name} for every lead added to Appsgain from now on.`}
          />
        )}
        {has("calendar_sync") && (connection || current.oauthReady) && (
          <Toggle
            checked={syncCalendar}
            onChange={setSyncCalendar}
            disabled={locked || !connection}
            label="Sync calendar events"
            description="Copy meetings and demos created in Appsgain onto this calendar."
          />
        )}
        {has("events") && (connection || showForm) && (
          <EventPicker
            events={events}
            selected={selectedEvents}
            onChange={setSelectedEvents}
            disabled={locked}
            legend={
              current.category === "ANALYTICS"
                ? "Events to track"
                : current.category === "AUTOMATION"
                  ? "Events that trigger the workflow"
                  : "Events to post"
            }
          />
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-alert-red/[0.08] p-3 text-[12.5px] leading-relaxed text-[#C93B3B]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-brand-green/[0.1] p-3 text-[12.5px] leading-relaxed text-deep-green">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
            {message}
          </p>
        )}
        {readOnly && (
          <p className="rounded-lg bg-slate-50 p-3 text-[12.5px] text-slate-500">
            Your role can see integrations but not connect or change them.
          </p>
        )}

        <a
          href={current.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent-blue hover:underline"
        >
          {current.name} setup guide
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} />
        </a>
      </div>
    </Modal>
  );
}
