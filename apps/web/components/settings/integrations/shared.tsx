"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  type IntegrationCategory,
  type IntegrationItem,
  type PlatformEventInfo,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

export const CATEGORY_META: Record<IntegrationCategory, { label: string; blurb: string }> = {
  CRM: { label: "CRM", blurb: "Send new leads to the CRM your sales team works in." },
  COMMUNICATION: {
    label: "Communication",
    blurb: "Chat alerts, notification email and WhatsApp.",
  },
  CALENDAR: { label: "Calendar", blurb: "Put booked demos and meetings on your calendar." },
  TELEPHONY: { label: "Telephony", blurb: "The carriers AI calls are placed through." },
  AI: { label: "AI models", blurb: "Language models for conversations and call summaries." },
  VOICE: { label: "Voice", blurb: "Speech-to-text and text-to-speech for calls." },
  STORAGE: { label: "Storage", blurb: "Where call recordings are kept." },
  AUTOMATION: { label: "Automation", blurb: "Trigger workflows in no-code automation tools." },
  ANALYTICS: { label: "Analytics", blurb: "Count leads and calls beside your other metrics." },
};

/** Events a receiver starts with when nobody has picked any — the ones worth interrupting for. */
export const DEFAULT_EVENTS: Partial<Record<IntegrationCategory, string[]>> = {
  COMMUNICATION: ["lead.created", "call.completed", "credits.low_balance"],
  AUTOMATION: ["lead.created", "lead.status_changed", "call.completed"],
};

export const INPUT =
  "h-11 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25 disabled:bg-slate-50 disabled:text-slate-500";

/** A readable message from anything thrown by the API client. */
export function messageOf(cause: unknown, fallback = "Something went wrong. Try again."): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} d ago`;
}

/** "HubSpot" → "HS", "Microsoft Teams" → "MT", "n8n" → "n8". */
function monogram(name: string): string {
  const words = name.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  const capitals = name.replace(/[^A-Z]/g, "");
  return capitals.length >= 2 ? capitals.slice(0, 2) : name.slice(0, 2);
}

/** Dark text on light brand colours, so every tile stays legible. */
function isLight(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62;
}

export function IntegrationLogo({
  name,
  color,
  large = false,
}: {
  name: string;
  color: string;
  large?: boolean;
}) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color, color: isLight(color) ? "#1B2A41" : "#FFFFFF" }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-bold tracking-tight",
        large ? "h-12 w-12 text-[15px]" : "h-10 w-10 text-[13px]",
      )}
    >
      {monogram(name)}
    </span>
  );
}

export function ConnectionBadge({ item }: { item: IntegrationItem }) {
  const connection = item.connection;
  if (connection?.status === "CONNECTED") {
    return connection.verified ? (
      <Badge tone="green">Connected</Badge>
    ) : (
      <Badge tone="amber">Saved · unverified</Badge>
    );
  }
  if (connection?.status === "ERROR") return <Badge tone="red">Needs attention</Badge>;
  if (connection?.status === "EXPIRED") return <Badge tone="amber">Sign-in expired</Badge>;
  if (item.auth === "oauth" && item.oauthReady === false) {
    return <Badge tone="gray">Needs server setup</Badge>;
  }
  return null;
}

/** One honest phrase for what the integration takes part in once connected. */
export function featureSummary(item: IntegrationItem): string {
  if (item.features.indexOf("lead_sync") >= 0) return "Syncs new leads";
  if (item.features.indexOf("calendar_sync") >= 0) return "Syncs calendar events";
  if (item.features.indexOf("email") >= 0) return "Sends notification email";
  if (item.features.indexOf("events") >= 0) {
    if (item.category === "AUTOMATION") return "Triggers workflows";
    if (item.category === "ANALYTICS") return "Sends analytics events";
    return "Posts alerts";
  }
  return "Checks and stores credentials";
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-[12.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-brand-green" strokeWidth={2.4} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={2.2} />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * Shows a secret exactly once. The server keeps only a hash or ciphertext, so this dialog
 * is the one moment the value exists anywhere a person can read it — and it says so.
 */
export function SecretDialog({
  open,
  title,
  description,
  secret,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  secret: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <Button className="h-10 bg-accent-blue hover:bg-[#1B6CD8]" onClick={onClose}>
          I have saved it
        </Button>
      }
    >
      <p className="rounded-lg bg-warning-amber/[0.12] p-3 text-[12.5px] leading-relaxed text-[#8A5A12]">
        Copy it now. It is stored only in a form that cannot be read back, so it will not be
        shown again — if it is lost, create a new one.
      </p>
      <div className="mt-3 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-50 px-3 py-2.5 font-mono text-[12.5px] text-brand-navy">
          {secret}
        </code>
        <CopyButton value={secret} />
      </div>
    </Modal>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-brand-navy">{label}</p>
        {description && <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-brand-green" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

export function EventPicker({
  events,
  selected,
  onChange,
  disabled,
  legend = "Events to send",
}: {
  events: PlatformEventInfo[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  legend?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12.5px] font-semibold text-slate-600">{legend}</legend>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {events.map((event) => {
          const on = selected.indexOf(event.key) >= 0;
          return (
            <label
              key={event.key}
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-50/70",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() =>
                  onChange(on ? selected.filter((key) => key !== event.key) : selected.concat(event.key))
                }
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-[#19B969]"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-brand-navy">
                  {event.label}
                  <code className="ml-1.5 font-mono text-[11px] font-normal text-slate-400">
                    {event.key}
                  </code>
                </span>
                <span className="block text-[12px] leading-relaxed text-slate-500">
                  {event.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A confirmation that takes two presses: the first arms it, the second (within 4s) acts. */
export function useTwoStep(): [string | null, (key: string | null) => void] {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return [armed, setArmed];
}
