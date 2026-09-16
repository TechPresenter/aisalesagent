"use client";

import Link from "next/link";
import {
  Bell,
  Building2,
  CalendarCheck,
  Check,
  Copy,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { ScoreBlock } from "@/components/ui/score-pill";
import { LeadSourceBadge, LeadStatusBadge } from "@/components/ui/status-badge";
import { AddFollowUpDialog } from "@/components/followups/add-follow-up-dialog";
import { placeCall, whatsAppHref, type ActionNotice } from "@/lib/lead-actions";
import type { LeadDetail } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const NEEDS_API = "Start the API to act on this lead.";

/**
 * The right-hand Lead Details panel on /leads — a preview that answers "should I call
 * this one?" without leaving the list. The full record is the detail page behind the
 * lead's name.
 */
export function LeadDetailsPanel({
  lead,
  live,
  onClose,
}: {
  lead: LeadDetail;
  /** False while the table shows seed rows, which have nothing to write to. */
  live: boolean;
  onClose: () => void;
}) {
  const lastCall = lead.calls[0];
  const [calling, setCalling] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);

  // Stable identities: the dialog resets its fields whenever these change.
  const leadRef = useMemo(() => ({ id: lead.id, name: lead.name }), [lead.id, lead.name]);
  const closeDialog = useCallback(() => setScheduling(false), []);

  const callNow = async () => {
    setCalling(true);
    setNotice(await placeCall(lead));
    setCalling(false);
  };

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="text-[16px] font-bold tracking-tight text-brand-navy">Lead Details</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close lead details"
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          <X className="h-4.5 w-4.5" strokeWidth={2} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-purple/[0.12]">
            <Building2 className="h-5 w-5 text-accent-purple" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={`/leads/${lead.id}`}
              className="block truncate text-[15px] font-bold text-brand-navy hover:text-brand-green"
            >
              {lead.name}
            </Link>
            <p className="truncate text-[12.5px] text-slate-500">{lead.contactPerson}</p>
            <p className="truncate text-[12.5px] text-slate-400">{lead.category}</p>
          </div>
          <ScoreBlock score={lead.score} />
        </div>

        <div className="mt-4 space-y-2.5">
          <ContactRow icon={Phone} value={lead.phone} copyable />
          {lead.email && <ContactRow icon={Mail} value={lead.email} copyable />}
          <ContactRow icon={MapPin} value={lead.address || lead.city} />
        </div>

        <dl className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
          <Row label="Source">
            <LeadSourceBadge source={lead.source} />
          </Row>
          <Row label="Status">
            <LeadStatusBadge status={lead.status} />
          </Row>
          <Row label="Assigned Agent">
            <span className="text-[12.5px] font-medium text-brand-navy">
              {lead.assignedAgent
                ? `${lead.assignedAgent.name} (${lead.assignedAgent.language})`
                : "Unassigned"}
            </span>
          </Row>
          <Row label="Date Added">
            <span className="tabular text-[12.5px] font-medium text-brand-navy">
              {formatDateTime(lead.addedOn)}
            </span>
          </Row>
        </dl>

        {lead.aiSummary && (
          <section className="mt-5">
            <div className="flex items-center gap-2">
              <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-accent-purple">
                <Sparkles className="h-2.5 w-2.5 text-white" strokeWidth={2.6} />
              </span>
              <h3 className="text-[13px] font-bold text-brand-navy">AI Summary</h3>
            </div>
            <p className="mt-2 rounded-lg bg-brand-green/[0.09] p-3 text-[12.5px] leading-relaxed text-brand-navy">
              {lead.aiSummary}
            </p>
          </section>
        )}

        {lastCall?.outcome && (
          <section className="mt-5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-accent-blue" strokeWidth={2} />
                <h3 className="text-[13px] font-bold text-brand-navy">Last Call Outcome</h3>
              </div>
              <span className="tabular shrink-0 text-right text-[11px] leading-tight text-slate-400">
                {formatDateTime(lastCall.startedAt)}
              </span>
            </div>
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600">
              {lead.notes.find((note) => note.author === "AI")?.text ??
                "Call completed. Summary pending."}
            </p>
          </section>
        )}

        {lead.nextFollowUp && (
          <section className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-accent-blue" strokeWidth={2} />
                <h3 className="text-[13px] font-bold text-brand-navy">Next Follow-up</h3>
              </div>
              {/* List rows from the API carry no follow-up (only the detail page loads them),
                  so this appears for seed rows alone — which have nothing to save to. */}
              <button
                type="button"
                disabled
                title={NEEDS_API}
                className="inline-flex shrink-0 cursor-not-allowed items-center gap-1 text-[11.5px] font-semibold text-slate-400"
              >
                <Bell className="h-3.5 w-3.5" strokeWidth={2} />
                Set Reminder
              </button>
            </div>
            <p className="tabular mt-2 text-[13px] font-semibold text-brand-navy">
              {formatDateTime(lead.nextFollowUp.dueAt)}
            </p>
            <p className="text-[12.5px] text-slate-500">{lead.nextFollowUp.description}</p>
          </section>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-4">
        {notice && (
          <p
            role="status"
            className={cn(
              "mb-3 rounded-btn px-3 py-2 text-[12px] font-medium",
              notice.tone === "ok"
                ? "bg-brand-green/[0.1] text-deep-green"
                : "bg-alert-red/[0.09] text-[#C93B3B]",
            )}
          >
            {notice.text}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <PanelAction
            icon={calling ? Loader2 : Phone}
            spin={calling}
            label="Call Now"
            onClick={() => void callNow()}
            disabled={!live || calling}
            className="bg-brand-green text-white hover:bg-[#15A45D]"
          />
          <PanelAction
            icon={MessageCircle}
            label="WhatsApp"
            href={whatsAppHref(lead.phone)}
            className="border border-slate-200 bg-surface text-brand-navy hover:bg-slate-50"
          />
          <PanelAction
            icon={CalendarCheck}
            label="Schedule Follow-up"
            onClick={() => setScheduling(true)}
            disabled={!live}
            className="bg-accent-blue text-white hover:bg-[#1B6CD8]"
          />
        </div>
      </div>

      {live && (
        <AddFollowUpDialog
          open={scheduling}
          onClose={closeDialog}
          onCreated={(text) => setNotice({ tone: "ok", text })}
          lead={leadRef}
        />
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-[12.5px] text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  value,
  copyable,
}: {
  icon: typeof Phone;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access is denied in some embedded contexts; the number is on screen
      // either way, so there is nothing useful to tell the user here.
    }
  };

  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-brand-navy">{value}</span>
      {copyable && (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${value}`}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-brand-green" strokeWidth={2.4} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      )}
    </div>
  );
}

function PanelAction({
  icon: Icon,
  label,
  className,
  onClick,
  href,
  disabled,
  spin,
}: {
  icon: typeof Phone;
  label: string;
  className: string;
  onClick?: () => void;
  /** Renders a link instead — for actions that leave the app, like WhatsApp. */
  href?: string;
  disabled?: boolean;
  spin?: boolean;
}) {
  const classes = cn(
    "flex h-10 items-center justify-center gap-1.5 rounded-btn px-2 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );
  const content = (
    <>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", spin && "animate-spin")} strokeWidth={2.2} />
      <span className="truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled && !spin ? NEEDS_API : undefined}
      className={classes}
    >
      {content}
    </button>
  );
}
