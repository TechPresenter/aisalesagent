"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Flag,
  FileText,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, MenuItem, MenuSeparator } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScoreBlock, ScorePill } from "@/components/ui/score-pill";
import { LeadSourceBadge, LeadStatusBadge, CallOutcomeBadge } from "@/components/ui/status-badge";
import { LEAD_PRIORITY, LEAD_STATUS, TONE_BADGE, type Tone } from "@/lib/status";
import { cn, formatDateTime, formatDuration, initialsOf } from "@/lib/utils";
import type { TranscriptSegment } from "@/lib/api-client";
import { whatsAppHref } from "@/lib/lead-actions";
import type { ActivityKind, LeadCall, LeadDetail } from "@/lib/types";

const TABS = [
  "Overview",
  "Call History",
  "Notes",
  "Follow-ups",
  "Transcripts",
  "Documents",
] as const;

type Tab = (typeof TABS)[number];

/**
 * What the page can do to the lead. Absent when the lead came from the seed set, which
 * has nothing to write to — the controls then render disabled rather than pretend.
 */
export interface LeadDetailActions {
  onCallNow: () => void;
  /** True while a call request is in flight, so Call Now cannot be pressed twice. */
  calling: boolean;
  onScheduleFollowUp: () => void;
  onAddNote: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Persists the tag list; rejects if the save failed, so the card can put it back. */
  onTagsChange: (tags: string[]) => Promise<void>;
  loadTranscript: (transcriptId: string) => Promise<TranscriptSegment[]>;
}

const NEEDS_API = "Start the API to act on this lead.";

/**
 * Feature List §2 — "Lead detail view: contact info, full call history, notes."
 *
 * Laid out as the spec screen fixes it: identity header, five at-a-glance metrics, then
 * a tabbed body with the AI column pinned alongside. The AI column stays put across tabs
 * on purpose — the summary and the assigned agent are the context you want while reading
 * any of them, not a seventh tab to go and find.
 */
export function LeadDetailView({
  lead,
  previousId,
  nextId,
  actions,
}: {
  lead: LeadDetail;
  previousId?: string;
  nextId?: string;
  actions?: LeadDetailActions;
}) {
  const [tab, setTab] = useState<Tab>("Overview");

  const totalDuration = lead.calls.reduce((sum, call) => sum + call.duration, 0);

  return (
    <>
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-accent-blue hover:underline"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
        Back to Leads
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-brand-navy sm:text-display">
            Lead Details
          </h1>
          <p className="mt-1.5 text-[14px] text-slate-500">
            View and manage complete information about this lead.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <NavButton href={previousId ? `/leads/${previousId}` : undefined} direction="previous" />
          <NavButton href={nextId ? `/leads/${nextId}` : undefined} direction="next" />
          <LeadActionsMenu actions={actions}>
            <button
              type="button"
              disabled={!actions}
              title={actions ? undefined : NEEDS_API}
              className="inline-flex h-11 items-center gap-2 rounded-btn bg-accent-blue px-5 text-[14.5px] font-semibold text-white transition-colors hover:bg-[#1B6CD8] disabled:opacity-50"
            >
              Actions
              <ChevronDown className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </LeadActionsMenu>
        </div>
      </div>

      <LeadHeroCard lead={lead} actions={actions} />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Phone} tone="blue" value={String(lead.calls.length)} label="Total Calls" />
        <Metric
          icon={Clock}
          tone="purple"
          value={totalDuration > 0 ? formatDuration(totalDuration) : "—"}
          label="Total Call Duration"
        />
        <Metric
          icon={CheckCircle2}
          tone={LEAD_STATUS[lead.status].tone}
          value={LEAD_STATUS[lead.status].label}
          label="Current Status"
        />
        <Metric
          icon={CalendarDays}
          tone="blue"
          value={
            lead.nextFollowUp
              ? formatDateTime(lead.nextFollowUp.dueAt).replace(", ", "\n")
              : "None scheduled"
          }
          label="Next Follow-up"
        />
        <Metric
          icon={Flag}
          tone={LEAD_PRIORITY[lead.priority].tone}
          value={LEAD_PRIORITY[lead.priority].label}
          label="Priority"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_332px]">
        <Card className="min-w-0 overflow-hidden">
          <div
            role="tablist"
            aria-label="Lead sections"
            className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-slate-100 px-4"
          >
            {TABS.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-3.5 text-[13.5px] font-semibold transition-colors",
                  tab === name
                    ? "border-brand-green text-brand-navy"
                    : "border-transparent text-slate-500 hover:text-brand-navy",
                )}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === "Overview" && (
              <OverviewTab
                lead={lead}
                onEdit={actions?.onEdit}
                onOpenTranscripts={() => setTab("Transcripts")}
              />
            )}
            {tab === "Call History" && <CallHistoryTab lead={lead} />}
            {tab === "Notes" && <NotesTab lead={lead} />}
            {tab === "Follow-ups" && <FollowUpsTab lead={lead} />}
            {tab === "Transcripts" && (
              <TranscriptsTab lead={lead} loadTranscript={actions?.loadTranscript} />
            )}
            {tab === "Documents" && <DocumentsTab />}
          </div>
        </Card>

        <div className="space-y-4">
          <AiSummaryCard lead={lead} />
          {/* Keyed on the saved tags so a reload after saving resets the card's local copy. */}
          <TagsCard key={lead.tags.join("|")} lead={lead} onChange={actions?.onTagsChange} />
          <AssignedAgentCard lead={lead} />
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Hero */

function LeadHeroCard({ lead, actions }: { lead: LeadDetail; actions?: LeadDetailActions }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-5">
        <div className="flex min-w-[260px] flex-1 items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent-purple/[0.13] text-[20px] font-bold text-accent-purple">
            {initialsOf(lead.name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[20px] font-bold tracking-tight text-brand-navy">{lead.name}</h2>
              <LeadStatusBadge status={lead.status} />
            </div>
            <p className="mt-0.5 text-[13.5px] text-slate-600">{lead.contactPerson}</p>
            <p className="text-[13.5px] text-slate-500">{lead.category}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <LeadSourceBadge source={lead.source} />
              {lead.tags.map((tag) => (
                <Badge key={tag} tone="blue">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <ScoreBlock score={lead.score} className="px-5 py-3" />

        <div className="min-w-[240px] flex-1 space-y-2">
          <HeroContact icon={Phone} value={lead.phone} copyable />
          {lead.email && <HeroContact icon={Mail} value={lead.email} copyable />}
          <HeroContact icon={MapPin} value={lead.address || lead.city} />
          <HeroContact icon={CalendarDays} value={`Added on ${formatDateTime(lead.addedOn)}`} />
        </div>

        <div className="flex w-[220px] shrink-0 flex-col gap-2">
          <HeroAction
            icon={actions?.calling ? Loader2 : Phone}
            label={actions?.calling ? "Placing call…" : "Call Now"}
            onClick={actions?.onCallNow}
            disabled={!actions || actions.calling}
            spin={actions?.calling}
            className="bg-brand-green text-white hover:bg-[#15A45D]"
          />
          <HeroAction
            icon={MessageCircle}
            label="WhatsApp"
            href={whatsAppHref(lead.phone)}
            className="border border-slate-200 bg-surface text-brand-navy hover:bg-slate-50"
          />
          <div className="flex gap-2">
            <HeroAction
              icon={CalendarCheck}
              label="Schedule Follow-up"
              onClick={actions?.onScheduleFollowUp}
              disabled={!actions}
              className="flex-1 bg-accent-blue text-white hover:bg-[#1B6CD8]"
            />
            <LeadActionsMenu actions={actions}>
              <button
                type="button"
                aria-label="More actions"
                disabled={!actions}
                title={actions ? undefined : NEEDS_API}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </LeadActionsMenu>
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeroContact({
  icon: Icon,
  value,
  copyable,
}: {
  icon: typeof Phone;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-brand-navy">{value}</span>
      {copyable && (
        <button
          type="button"
          aria-label={copied ? "Copied" : `Copy ${value}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            } catch {
              /* clipboard blocked; the value is on screen regardless */
            }
          }}
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

function HeroAction({
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
    "flex h-10 items-center justify-center gap-2 rounded-btn px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );
  const content = (
    <>
      <Icon className={cn("h-4 w-4 shrink-0", spin && "animate-spin")} strokeWidth={2.2} />
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

/**
 * The lead's secondary actions, shared by the header's Actions button and the hero's
 * overflow button so the two can never offer different things.
 */
function LeadActionsMenu({
  actions,
  children,
}: {
  actions?: LeadDetailActions;
  children: React.ReactElement;
}) {
  if (!actions) return children;

  return (
    <DropdownMenu trigger={children}>
      <MenuItem onSelect={actions.onEdit}>
        <Pencil className="h-4 w-4 text-slate-400" strokeWidth={2} />
        Edit details
      </MenuItem>
      <MenuItem onSelect={actions.onAddNote}>
        <StickyNote className="h-4 w-4 text-slate-400" strokeWidth={2} />
        Add note
      </MenuItem>
      <MenuItem onSelect={actions.onScheduleFollowUp}>
        <CalendarCheck className="h-4 w-4 text-slate-400" strokeWidth={2} />
        Schedule follow-up
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={actions.onDelete} danger>
        <Trash2 className="h-4 w-4" strokeWidth={2} />
        Delete lead
      </MenuItem>
    </DropdownMenu>
  );
}

function NavButton({ href, direction }: { href?: string; direction: "previous" | "next" }) {
  const label = direction === "previous" ? "Previous" : "Next";
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;

  const inner = (
    <>
      {direction === "previous" && <Icon className="h-4 w-4" strokeWidth={2.2} />}
      {label}
      {direction === "next" && <Icon className="h-4 w-4" strokeWidth={2.2} />}
    </>
  );

  const className =
    "inline-flex h-11 items-center gap-1.5 rounded-btn border border-slate-200 bg-surface px-4 text-[14px] font-medium text-brand-navy transition-colors hover:bg-slate-50";

  // Disabled at the ends of the list rather than hidden, so the pair does not reflow the
  // header when you reach the first or last lead.
  if (!href) {
    return (
      <span className={cn(className, "pointer-events-none opacity-45")} aria-disabled>
        {inner}
      </span>
    );
  }

  return (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}

/* ------------------------------------------------------------- Metrics */

function Metric({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: typeof Phone;
  tone: Tone;
  value: string;
  label: string;
}) {
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
          TONE_BADGE[tone],
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="tabular whitespace-pre-line text-[16px] font-bold leading-tight text-brand-navy">
          {value}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-slate-500">{label}</p>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- Tabs */

function OverviewTab({
  lead,
  onEdit,
  onOpenTranscripts,
}: {
  lead: LeadDetail;
  onEdit?: () => void;
  onOpenTranscripts: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[16px] font-bold tracking-tight text-brand-navy">Lead Information</h3>
          <button
            type="button"
            onClick={onEdit}
            disabled={!onEdit}
            title={onEdit ? undefined : NEEDS_API}
            className="inline-flex items-center gap-1.5 rounded-btn border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-medium text-brand-navy transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
            Edit
          </button>
        </div>

        <dl className="divide-y divide-slate-100 border-t border-slate-100">
          <InfoRow label="Clinic Name" value={lead.name} />
          <InfoRow label="Contact Person" value={lead.contactPerson} />
          <InfoRow label="Phone Number" value={lead.phone} tabular />
          <InfoRow label="Email" value={lead.email ?? "—"} />
          <InfoRow label="City" value={lead.city} />
          <InfoRow label="Source">
            <LeadSourceBadge source={lead.source} />
          </InfoRow>
          <InfoRow label="Campaign" value={lead.campaign ?? "—"} />
          <InfoRow label="Lead Score">
            <ScorePill score={lead.score} />
          </InfoRow>
          <InfoRow label="Status">
            <LeadStatusBadge status={lead.status} />
          </InfoRow>
          <InfoRow label="Tags">
            <span className="flex flex-wrap justify-end gap-1.5">
              {lead.tags.length > 0
                ? lead.tags.map((tag) => (
                    <Badge key={tag} tone="blue">
                      {tag}
                    </Badge>
                  ))
                : "—"}
            </span>
          </InfoRow>
          <InfoRow label="Website">
            {lead.website ? (
              <a
                href={lead.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-blue hover:underline"
              >
                {lead.website}
                <ExternalLink className="h-3 w-3" strokeWidth={2.2} />
              </a>
            ) : (
              "—"
            )}
          </InfoRow>
          <InfoRow label="Address" value={lead.address || "—"} />
          <InfoRow label="Notes" value={lead.freeformNotes ?? "—"} />
        </dl>
      </section>

      <ActivityTimeline lead={lead} onOpenTranscripts={onOpenTranscripts} />
    </div>
  );
}

function InfoRow({
  label,
  value,
  children,
  tabular,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  tabular?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13px] text-slate-500">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-[13px] font-medium text-brand-navy",
          tabular && "tabular",
        )}
      >
        {children ?? value}
      </dd>
    </div>
  );
}

const ACTIVITY_STYLE: Record<ActivityKind, { icon: typeof Phone; tone: Tone }> = {
  CALL: { icon: Phone, tone: "blue" },
  NOTE: { icon: StickyNote, tone: "amber" },
  FOLLOW_UP: { icon: CalendarCheck, tone: "blue" },
  TRANSCRIPT: { icon: FileText, tone: "purple" },
  EMAIL: { icon: Mail, tone: "gray" },
  STATUS_CHANGE: { icon: CheckCircle2, tone: "green" },
};

function ActivityTimeline({
  lead,
  onOpenTranscripts,
}: {
  lead: LeadDetail;
  onOpenTranscripts: () => void;
}) {
  const [filter, setFilter] = useState<"all" | ActivityKind>("all");

  const events =
    filter === "all" ? lead.activity : lead.activity.filter((event) => event.kind === filter);

  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-bold tracking-tight text-brand-navy">Activity Timeline</h3>
        <div className="relative">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as "all" | ActivityKind)}
            aria-label="Filter activity"
            className="h-8 appearance-none rounded-btn border border-slate-200 bg-surface pl-2.5 pr-8 text-[12.5px] font-medium text-brand-navy hover:bg-slate-50 focus:border-brand-green focus:outline-none"
          >
            <option value="all">All Activities</option>
            <option value="CALL">Calls</option>
            <option value="NOTE">Notes</option>
            <option value="FOLLOW_UP">Follow-ups</option>
            <option value="TRANSCRIPT">Transcripts</option>
            <option value="EMAIL">Emails</option>
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            strokeWidth={2}
          />
        </div>
      </div>

      {events.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-slate-400">No activity of this kind yet.</p>
      ) : (
        <ol className="relative space-y-4">
          {events.map((event, index) => {
            const { icon: Icon, tone } = ACTIVITY_STYLE[event.kind];
            return (
              <li key={event.id} className="relative flex gap-3.5">
                {/* The connector stops before the last item so the line does not dangle
                    past the final event. */}
                {index < events.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[19px] top-11 h-[calc(100%-1rem)] w-px bg-slate-150 bg-slate-200"
                  />
                )}
                <span
                  className={cn(
                    "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    TONE_BADGE[tone],
                  )}
                >
                  <Icon className="h-4.5 w-4.5" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-[13.5px] font-semibold text-brand-navy">{event.title}</p>
                    <p className="tabular shrink-0 text-[11.5px] text-slate-400">
                      {formatDateTime(event.timestamp)}
                    </p>
                  </div>
                  {event.subtitle && (
                    <p className="text-[12.5px] text-slate-500">{event.subtitle}</p>
                  )}
                  {event.detail && (
                    <p className="mt-1.5 rounded-lg bg-slate-50 p-2.5 text-[12.5px] leading-relaxed text-slate-600">
                      {event.detail}
                    </p>
                  )}
                  {event.kind === "TRANSCRIPT" && (
                    <button
                      type="button"
                      onClick={onOpenTranscripts}
                      className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent-blue hover:underline"
                    >
                      View Full Transcript
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.4} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function CallHistoryTab({ lead }: { lead: LeadDetail }) {
  if (lead.calls.length === 0) {
    return <EmptyTab message="This lead has not been called yet." />;
  }

  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-left">
        <thead>
          <tr className="bg-slate-50/80">
            {["Date & Time", "Duration", "Outcome", "AI Agent", "Campaign", "Recording"].map(
              (header) => (
                <th
                  key={header}
                  scope="col"
                  className="whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {lead.calls.map((call) => (
            <tr key={call.id} className="border-t border-slate-100 hover:bg-slate-50/70">
              <td className="tabular whitespace-nowrap px-3 py-3 text-[12.5px] text-brand-navy">
                {formatDateTime(call.startedAt)}
              </td>
              <td className="tabular px-3 py-3 text-[12.5px] text-slate-600">
                {call.duration > 0 ? formatDuration(call.duration) : "—"}
              </td>
              <td className="px-3 py-3">
                {call.outcome ? <CallOutcomeBadge outcome={call.outcome} /> : "—"}
              </td>
              <td className="px-3 py-3 text-[12.5px] text-slate-600">{call.personaName}</td>
              <td className="px-3 py-3 text-[12.5px] text-slate-600">{call.campaignName}</td>
              <td className="px-3 py-3">
                {call.hasRecording ? (
                  // The audio lives in object storage and none is connected yet — the
                  // Recordings page says the same. Named, rather than a dead Play button.
                  <span
                    title="No object storage is connected, so recordings cannot be played yet."
                    className="text-[12.5px] font-medium text-slate-500"
                  >
                    Recorded
                  </span>
                ) : (
                  <span className="text-[12.5px] text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The outcome enum and the status enum overlap by name; this is the one mapping point. */
function NotesTab({ lead }: { lead: LeadDetail }) {
  if (lead.notes.length === 0) return <EmptyTab message="No notes on this lead yet." />;

  return (
    <ul className="space-y-3">
      {lead.notes.map((note) => (
        <li key={note.id} className="rounded-lg border border-slate-200 p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-brand-navy">
              {note.author === "AI" && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-purple">
                  <Sparkles className="h-2.5 w-2.5 text-white" strokeWidth={2.6} />
                </span>
              )}
              {note.authorName}
            </span>
            <span className="tabular text-[11.5px] text-slate-400">
              {formatDateTime(note.timestamp)}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{note.text}</p>
        </li>
      ))}
    </ul>
  );
}

function FollowUpsTab({ lead }: { lead: LeadDetail }) {
  if (!lead.nextFollowUp) return <EmptyTab message="No follow-up scheduled for this lead." />;

  return (
    <div className="flex items-start gap-3.5 rounded-lg border border-slate-200 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-blue/[0.13]">
        <CalendarCheck className="h-4.5 w-4.5 text-accent-blue" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="tabular text-[14px] font-semibold text-brand-navy">
          {formatDateTime(lead.nextFollowUp.dueAt)}
        </p>
        <p className="mt-0.5 text-[13px] text-slate-500">{lead.nextFollowUp.description}</p>
      </div>
    </div>
  );
}

function TranscriptsTab({
  lead,
  loadTranscript,
}: {
  lead: LeadDetail;
  loadTranscript?: (transcriptId: string) => Promise<TranscriptSegment[]>;
}) {
  // Live calls say whether they were transcribed; seed calls only whether they were recorded.
  const transcribed = lead.calls.filter((call) =>
    loadTranscript ? Boolean(call.transcriptId) : call.hasRecording,
  );
  if (transcribed.length === 0) {
    return <EmptyTab message="No transcripts yet — they are generated after a connected call." />;
  }

  return (
    <ul className="space-y-2.5">
      {transcribed.map((call) => (
        <TranscriptRow
          key={call.id}
          call={call}
          load={
            call.transcriptId && loadTranscript
              ? () => loadTranscript(call.transcriptId as string)
              : undefined
          }
        />
      ))}
    </ul>
  );
}

/** One transcribed call; the utterances are fetched the first time it is opened. */
function TranscriptRow({
  call,
  load,
}: {
  call: LeadCall;
  load?: () => Promise<TranscriptSegment[]>;
}) {
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !segments && load) {
      setFailed(false);
      try {
        setSegments(await load());
      } catch {
        setFailed(true);
      }
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-[13px] font-semibold text-brand-navy">
            {formatDateTime(call.startedAt)}
          </p>
          <p className="text-[12.5px] text-slate-500">
            {call.personaName} &middot; {formatDuration(call.duration)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={!load}
          title={load ? undefined : NEEDS_API}
          aria-expanded={open}
          className="shrink-0 text-[12.5px] font-semibold text-accent-blue hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
        >
          {open ? "Hide Transcript" : "View Transcript"}
        </button>
      </div>

      {call.transcriptSummary && (
        <p className="mt-2 rounded-lg bg-brand-green/[0.09] p-2.5 text-[12.5px] leading-relaxed text-brand-navy">
          {call.transcriptSummary}
        </p>
      )}

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {failed ? (
            <p className="text-[12.5px] text-[#C93B3B]">Could not load the transcript.</p>
          ) : !segments ? (
            <p className="flex items-center gap-2 text-[12.5px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
              Loading transcript&hellip;
            </p>
          ) : segments.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">This transcript has no utterances.</p>
          ) : (
            <ol className="space-y-2">
              {segments.map((segment) => (
                <li key={segment.id} className="text-[12.5px] leading-relaxed">
                  <span
                    className={cn(
                      "font-semibold",
                      segment.speaker === "LEAD" ? "text-accent-blue" : "text-accent-purple",
                    )}
                  >
                    {segment.speakerLabel}:
                  </span>{" "}
                  <span className="text-slate-600">{segment.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

function DocumentsTab() {
  return <EmptyTab message="No documents attached to this lead." />;
}

function EmptyTab({ message }: { message: string }) {
  return <p className="py-12 text-center text-[13.5px] text-slate-400">{message}</p>;
}

/* ------------------------------------------------------------ AI column */

function AiSummaryCard({ lead }: { lead: LeadDetail }) {
  if (!lead.aiSummary) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-purple">
          <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.4} />
        </span>
        <h3 className="text-[15px] font-bold tracking-tight text-brand-navy">AI Summary</h3>
      </div>

      <p className="mt-3 rounded-lg bg-brand-green/[0.09] p-3 text-[12.5px] leading-relaxed text-brand-navy">
        {lead.aiSummary}
      </p>

      {lead.keyPoints.length > 0 && (
        <>
          <h4 className="mt-4 text-[13px] font-bold text-brand-navy">Key Points</h4>
          <ul className="mt-2 space-y-1.5">
            {lead.keyPoints.map((point) => (
              <li key={point} className="flex items-start gap-2">
                <CheckCircle2
                  className="mt-px h-3.5 w-3.5 shrink-0 text-brand-green"
                  strokeWidth={2.2}
                />
                <span className="text-[12.5px] leading-snug text-slate-600">{point}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function TagsCard({
  lead,
  onChange,
}: {
  lead: LeadDetail;
  onChange?: (tags: string[]) => Promise<void>;
}) {
  // Local state so the chips respond at once; `onChange` persists them to the lead's custom
  // fields. Seed leads have nowhere to save to, so there the edit stays on screen only.
  const [tags, setTags] = useState(lead.tags);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = (next: string[]) => {
    const previous = tags;
    setTags(next);
    // Put the chips back if the save fails, so the card never shows tags that are not stored.
    onChange?.(next).catch(() => setTags(previous));
  };

  const add = () => {
    const tag = draft.trim();
    setDraft("");
    setAdding(false);
    if (!tag || tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    commit([...tags, tag]);
  };

  return (
    <Card className="p-4">
      <CardHeader className="p-0">
        <CardTitle className="text-[15px]">Lead Tags</CardTitle>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded-btn border border-slate-200 px-2 py-1 text-[12px] font-medium text-brand-navy transition-colors hover:bg-slate-50"
        >
          <Plus className="h-3 w-3" strokeWidth={2.4} />
          Add Tag
        </button>
      </CardHeader>

      {adding && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
          className="mt-3 flex gap-2"
        >
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            maxLength={40}
            placeholder="e.g. Decision maker"
            aria-label="New tag"
            className="h-8 min-w-0 flex-1 rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none"
          />
          <button
            type="submit"
            className="h-8 shrink-0 rounded-btn bg-brand-green px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#15A45D]"
          >
            Add
          </button>
        </form>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.length === 0 && <p className="text-[12.5px] text-slate-400">No tags yet.</p>}
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-accent-blue/[0.13] py-1 pl-2.5 pr-1.5 text-[11.5px] font-semibold text-accent-blue"
          >
            {tag}
            <button
              type="button"
              onClick={() => commit(tags.filter((t) => t !== tag))}
              aria-label={`Remove tag ${tag}`}
              className="rounded-full p-0.5 transition-colors hover:bg-accent-blue/20"
            >
              <X className="h-3 w-3" strokeWidth={2.6} />
            </button>
          </span>
        ))}
      </div>
    </Card>
  );
}

function AssignedAgentCard({ lead }: { lead: LeadDetail }) {
  const agent = lead.assignedAgent;

  return (
    <Card className="p-4">
      <CardHeader className="p-0">
        <CardTitle className="text-[15px]">Assigned Agent</CardTitle>
        {/* Agents are assigned per campaign, not per lead, so this manages the agents. */}
        <Link
          href="/agents"
          className="inline-flex shrink-0 items-center gap-1 rounded-btn border border-slate-200 px-2 py-1 text-[12px] font-medium text-brand-navy transition-colors hover:bg-slate-50"
        >
          <Pencil className="h-3 w-3 text-slate-400" strokeWidth={2.2} />
          Manage
        </Link>
      </CardHeader>

      {agent ? (
        <div className="mt-3 flex items-center gap-3">
          {agent.avatarUrl ? (
            <Image
              src={agent.avatarUrl}
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-purple/[0.13] text-[14px] font-bold text-accent-purple">
              {initialsOf(agent.name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-bold text-brand-navy">
              {agent.name} ({agent.language})
            </p>
            <p className="text-[12.5px] text-slate-500">AI Sales Agent</p>
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-brand-green">
            <span className="h-2 w-2 rounded-full bg-brand-green" />
            Online
          </span>
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-slate-400">No agent assigned.</p>
      )}
    </Card>
  );
}
