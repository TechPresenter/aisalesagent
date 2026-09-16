"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  History,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Send,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import {
  webhooksApi,
  type PlatformEventInfo,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
} from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";
import { CopyButton, EventPicker, INPUT, SecretDialog, messageOf, timeAgo, useTwoStep } from "./shared";

const DELIVERY_TONE: Record<WebhookDeliveryStatus, "green" | "amber" | "red" | "gray"> = {
  SUCCEEDED: "green",
  PENDING: "gray",
  FAILED: "amber",
  EXHAUSTED: "red",
};

const DELIVERY_LABEL: Record<WebhookDeliveryStatus, string> = {
  SUCCEEDED: "Delivered",
  PENDING: "Pending",
  FAILED: "Retrying",
  EXHAUSTED: "Failed",
};

const VERIFY_SNIPPET = [
  'const crypto = require("crypto");',
  "",
  "// rawBody: the request body exactly as received, before any JSON parsing.",
  "function isFromAppsgain(rawBody, headers, secret) {",
  '  const timestamp = headers["x-appsgain-timestamp"];',
  '  const received = headers["x-appsgain-signature"] || "";',
  '  const expected = "sha256=" + crypto',
  '    .createHmac("sha256", secret)',
  "    .update(timestamp + \".\" + rawBody)",
  '    .digest("hex");',
  "  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;",
  "  return fresh && received.length === expected.length &&",
  "    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));",
  "}",
].join("\n");

/**
 * Settings → Integrations → Webhooks: outbound event subscriptions to a workspace's own
 * systems. Endpoints created by an automation app (Zapier, Make…) appear here too, marked
 * as managed, because their deliveries are logged here like any other.
 */
export function WebhooksPanel({
  events,
  canManage,
  onNotice,
  onError,
}: {
  events: PlatformEventInfo[];
  canManage: boolean;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [hooks, setHooks] = useState<WebhookEndpoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [logFor, setLogFor] = useState<WebhookEndpoint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useTwoStep();

  const load = useCallback(() => {
    webhooksApi.list().then(
      (rows) => {
        setHooks(rows);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    if (canManage) load();
  }, [canManage, load]);

  const closeAdd = useCallback(() => setAdding(false), []);
  const closeSecret = useCallback(() => setSecret(null), []);
  const closeLog = useCallback(() => {
    setLogFor(null);
    load();
  }, [load]);

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <Card className="p-5">
        <CardTitle>Webhooks</CardTitle>
        <p className="mt-2 text-[13px] text-slate-500">
          Managing webhooks needs the webhooks permission, which starts at the Admin role. A
          webhook receives lead names and phone numbers, so creating one is a data-sharing
          decision.
        </p>
      </Card>
    );
  }

  const labelOf = (key: string) => events.find((event) => event.key === key)?.label ?? key;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader className="p-0">
          <div className="min-w-0">
            <CardTitle>Webhooks</CardTitle>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              Send events to your own systems as they happen. Every request is signed, logged,
              and retried for up to a day if your endpoint is down.
            </p>
          </div>
          <Button className="h-10 shrink-0" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            Add endpoint
          </Button>
        </CardHeader>

        {failed ? (
          <p className="mt-4 text-[13px] text-slate-500">Could not load webhooks.</p>
        ) : !hooks ? (
          <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
        ) : hooks.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <p className="text-[13.5px] font-semibold text-brand-navy">No endpoints yet</p>
            <p className="mt-1 text-[12.5px] text-slate-500">
              Add a URL on your server and pick the events it should receive.
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {hooks.map((hook) => (
              <li key={hook.id} className="p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12.5px] font-semibold text-brand-navy" title={hook.url}>
                      {hook.url}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={hook.isActive ? "green" : "gray"}>{hook.isActive ? "Active" : "Paused"}</Badge>
                      {hook.managedBy && <Badge tone="purple">Managed by {hook.managedBy}</Badge>}
                      {hook.failuresLast24h > 0 && (
                        <Badge tone="red">
                          {hook.failuresLast24h} failed in 24 h
                        </Badge>
                      )}
                      {hook.description && !hook.managedBy && (
                        <span className="text-[12px] text-slate-500">{hook.description}</span>
                      )}
                    </div>
                  </div>
                  <p className="text-right text-[11.5px] text-slate-400">
                    {hook.lastDelivery ? (
                      <>
                        Last: {DELIVERY_LABEL[hook.lastDelivery.status]}
                        {hook.lastDelivery.responseStatus ? ` (${hook.lastDelivery.responseStatus})` : ""} ·{" "}
                        {timeAgo(hook.lastDelivery.createdAt)}
                      </>
                    ) : (
                      "No deliveries yet"
                    )}
                  </p>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {hook.events.map((event) => (
                    <span
                      key={event}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-600"
                    >
                      {labelOf(event)}
                    </span>
                  ))}
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <RowButton
                    icon={Send}
                    label="Send test"
                    busy={busy === `test:${hook.id}`}
                    disabled={busy !== null}
                    onClick={() =>
                      void act(`test:${hook.id}`, async () => {
                        const delivery = await webhooksApi.test(hook.id);
                        if (delivery.status === "SUCCEEDED") {
                          onNotice(`Test event delivered (HTTP ${delivery.responseStatus}).`);
                        } else {
                          onError(`Test event not delivered: ${delivery.error ?? "no response"}`);
                        }
                        load();
                      })
                    }
                  />
                  <RowButton icon={History} label="Deliveries" disabled={busy !== null} onClick={() => setLogFor(hook)} />
                  <RowButton
                    icon={hook.isActive ? Pause : Play}
                    label={hook.isActive ? "Pause" : "Resume"}
                    busy={busy === `toggle:${hook.id}`}
                    disabled={busy !== null}
                    onClick={() =>
                      void act(`toggle:${hook.id}`, async () => {
                        await webhooksApi.update(hook.id, { isActive: !hook.isActive });
                        onNotice(hook.isActive ? "Endpoint paused. Events are not sent to it." : "Endpoint resumed.");
                        load();
                      })
                    }
                  />
                  <RowButton
                    icon={RotateCw}
                    label={armed === `rotate:${hook.id}` ? "Confirm rotate" : "Rotate secret"}
                    danger={armed === `rotate:${hook.id}`}
                    busy={busy === `rotate:${hook.id}`}
                    disabled={busy !== null}
                    onClick={() => {
                      if (armed !== `rotate:${hook.id}`) {
                        setArmed(`rotate:${hook.id}`);
                        return;
                      }
                      setArmed(null);
                      void act(`rotate:${hook.id}`, async () => {
                        const rotated = await webhooksApi.rotateSecret(hook.id);
                        setSecret({ title: "New signing secret", value: rotated.secret });
                      });
                    }}
                  />
                  {!hook.managedBy && (
                    <RowButton
                      icon={Trash2}
                      label={armed === `delete:${hook.id}` ? "Confirm delete" : "Delete"}
                      danger
                      busy={busy === `delete:${hook.id}`}
                      disabled={busy !== null}
                      onClick={() => {
                        if (armed !== `delete:${hook.id}`) {
                          setArmed(`delete:${hook.id}`);
                          return;
                        }
                        setArmed(null);
                        void act(`delete:${hook.id}`, async () => {
                          await webhooksApi.remove(hook.id);
                          onNotice("Endpoint deleted, with its delivery log.");
                          load();
                        });
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle>Verifying requests</CardTitle>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">
          Each request carries <code className="rounded bg-slate-100 px-1 font-mono text-[11.5px]">X-Appsgain-Signature</code>{" "}
          (HMAC-SHA256 of <code className="rounded bg-slate-100 px-1 font-mono text-[11.5px]">timestamp.body</code> with the
          endpoint&apos;s secret),{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-[11.5px]">X-Appsgain-Timestamp</code>,{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-[11.5px]">X-Appsgain-Event</code> and{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-[11.5px]">X-Appsgain-Delivery</code>. Answer with any
          2xx within ten seconds; anything else is retried after 1 minute, 5, 30, 2 hours and 8 hours. Redirects
          are not followed. A redelivery keeps the event&apos;s <code className="font-mono text-[11.5px]">id</code>, so
          de-duplicate on it.
        </p>
        <div className="relative mt-3">
          <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-brand-navy p-3.5 font-mono text-[11.5px] leading-relaxed text-slate-100">
            {VERIFY_SNIPPET}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyButton value={VERIFY_SNIPPET} />
          </div>
        </div>
      </Card>

      <AddEndpointDialog
        open={adding}
        events={events}
        onClose={closeAdd}
        onCreated={(created) => {
          setAdding(false);
          setSecret({ title: "Endpoint added", value: created.secret });
          load();
        }}
      />

      {secret && (
        <SecretDialog
          open
          title={secret.title}
          description="Use this signing secret to verify that requests came from Appsgain."
          secret={secret.value}
          onClose={closeSecret}
        />
      )}

      <DeliveryLogDialog hook={logFor} labelOf={labelOf} onClose={closeLog} onError={onError} />
    </div>
  );
}

function RowButton({
  icon: Icon,
  label,
  onClick,
  busy,
  disabled,
  danger,
}: {
  icon: typeof Send;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-btn border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50",
        danger
          ? "border-alert-red/40 text-alert-red hover:bg-alert-red/[0.06]"
          : "border-slate-200 text-brand-navy hover:bg-slate-50",
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
      ) : (
        <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
      )}
      {label}
    </button>
  );
}

function AddEndpointDialog({
  open,
  events,
  onClose,
  onCreated,
}: {
  open: boolean;
  events: PlatformEventInfo[];
  onClose: () => void;
  onCreated: (created: { webhook: WebhookEndpoint; secret: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>(["lead.created"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setDescription("");
    setSelected(["lead.created"]);
    setError(null);
  }, [open]);

  async function submit() {
    if (!/^https?:\/\//i.test(url.trim())) {
      setError("Enter the full URL, starting with https://.");
      return;
    }
    if (selected.length === 0) {
      setError("Pick at least one event.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onCreated(
        await webhooksApi.create({
          url: url.trim(),
          events: selected,
          description: description.trim() || undefined,
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
      title="Add webhook endpoint"
      description="Appsgain will POST a signed JSON event to this URL."
      footer={
        <>
          <Button variant="secondary" className="h-10" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="h-10 bg-accent-blue hover:bg-[#1B6CD8]" onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
            Add endpoint
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">
            Endpoint URL<span className="ml-0.5 text-alert-red">*</span>
          </span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/webhooks/appsgain"
            className={cn(INPUT, "font-mono text-[13px]")}
            disabled={saving}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">
            Description <span className="font-normal text-slate-400">(optional)</span>
          </span>
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Data warehouse sync"
            maxLength={200}
            className={INPUT}
            disabled={saving}
          />
        </label>
        <EventPicker events={events} selected={selected} onChange={setSelected} disabled={saving} />
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

function DeliveryLogDialog({
  hook,
  labelOf,
  onClose,
  onError,
}: {
  hook: WebhookEndpoint | null;
  labelOf: (key: string) => string;
  onClose: () => void;
  onError: (text: string) => void;
}) {
  const [rows, setRows] = useState<WebhookDelivery[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [redelivering, setRedelivering] = useState<string | null>(null);
  const hookId = hook?.id ?? null;

  const load = useCallback(() => {
    if (!hookId) return;
    webhooksApi.deliveries(hookId, 50).then(setRows, (cause) => {
      setRows([]);
      onError(messageOf(cause, "Could not load the delivery log."));
    });
  }, [hookId, onError]);

  useEffect(() => {
    setRows(null);
    setExpanded(null);
    load();
  }, [load]);

  if (!hook) return null;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Delivery log"
      description={hook.url}
      footer={
        <>
          <Button variant="secondary" className="mr-auto h-10" onClick={load}>
            <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
            Refresh
          </Button>
          <Button variant="secondary" className="h-10" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {!rows ? (
        <p className="py-6 text-center text-[13px] text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-slate-500">Nothing has been sent to this endpoint yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((row) => (
            <li key={row.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={DELIVERY_TONE[row.status]}>{DELIVERY_LABEL[row.status]}</Badge>
                <span className="text-[13px] font-semibold text-brand-navy">
                  {row.event === "test.ping" ? "Test event" : labelOf(row.event)}
                </span>
                {row.responseStatus !== null && (
                  <span className="tabular text-[12px] text-slate-500">HTTP {row.responseStatus}</span>
                )}
                <span className="tabular text-[12px] text-slate-400">
                  {row.attempts} {row.attempts === 1 ? "attempt" : "attempts"}
                </span>
                <span className="ml-auto text-[12px] text-slate-400" title={formatDateTime(row.createdAt)}>
                  {timeAgo(row.createdAt)}
                </span>
              </div>
              {row.error && <p className="mt-1 text-[12px] text-[#C93B3B]">{row.error}</p>}
              {row.status === "FAILED" && row.nextAttemptAt && (
                <p className="mt-1 text-[12px] text-slate-500">
                  Next attempt {formatDateTime(row.nextAttemptAt)}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  className="inline-flex h-7 items-center gap-1 rounded-btn border border-slate-200 px-2 text-[11.5px] font-semibold text-brand-navy hover:bg-slate-50"
                >
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", expanded === row.id && "rotate-180")}
                    strokeWidth={2.2}
                  />
                  {expanded === row.id ? "Hide payload" : "Payload"}
                </button>
                <button
                  type="button"
                  disabled={redelivering !== null}
                  onClick={() => {
                    setRedelivering(row.id);
                    webhooksApi
                      .redeliver(row.id)
                      .then(
                        () => load(),
                        (cause) => onError(messageOf(cause, "Could not redeliver.")),
                      )
                      .then(() => setRedelivering(null));
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded-btn border border-slate-200 px-2 text-[11.5px] font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-50"
                >
                  {redelivering === row.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                  ) : (
                    <Send className="h-3.5 w-3.5" strokeWidth={2.2} />
                  )}
                  Redeliver
                </button>
              </div>
              {expanded === row.id && (
                <div className="mt-2 space-y-2">
                  <pre className="scrollbar-thin max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-[11.5px] leading-relaxed text-brand-navy">
                    {JSON.stringify(row.payload, null, 2)}
                  </pre>
                  {row.responseBody && (
                    <>
                      <p className="text-[11.5px] font-semibold text-slate-500">Response body</p>
                      <pre className="scrollbar-thin max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-[11.5px] text-slate-600">
                        {row.responseBody}
                      </pre>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
