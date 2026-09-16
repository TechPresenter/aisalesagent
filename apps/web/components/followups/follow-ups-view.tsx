"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-select";
import { Pagination } from "@/components/ui/pagination";
import { LeadStatusBadge } from "@/components/ui/status-badge";
import {
  ApiError,
  campaignsApi,
  followUpsApi,
  usersApi,
  type ApiCampaign,
  type ApiFollowUp,
  type DerivedFollowUpStatus,
  type FollowUpChannel,
  type Priority,
  type WorkspaceMember,
} from "@/lib/api-client";
import { CALL_OUTCOME } from "@/lib/status";
import { useDebounced } from "@/lib/use-debounced";
import { toRole, useSessionUser } from "@/lib/use-session";
import { hasPermission } from "@appsgain/shared";
import { cn, formatDateTime, formatDuration, formatNumber } from "@/lib/utils";
import type { Tone } from "@/lib/status";

const ALL = "all";
const PAGE_SIZE = 10;

/**
 * The five states the queue is organised by.
 *
 * Only three of them are stored — TODAY and OVERDUE are derived by the API from the due
 * date against the *workspace's* clock, and arrive as `derivedStatus`. Nothing here
 * recomputes them from the browser's clock, because a rep in another timezone would
 * otherwise see a different queue from their manager.
 */
const STATUS: Record<DerivedFollowUpStatus, { label: string; tone: Tone }> = {
  OVERDUE: { label: "Overdue", tone: "red" },
  TODAY: { label: "Today", tone: "amber" },
  PENDING: { label: "Upcoming", tone: "blue" },
  COMPLETED: { label: "Completed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};

const CHANNEL: Record<FollowUpChannel, { label: string; icon: typeof Phone }> = {
  CALL: { label: "Call", icon: Phone },
  WHATSAPP: { label: "WhatsApp", icon: MessageSquare },
  EMAIL: { label: "Email", icon: Mail },
  MEETING: { label: "Meeting", icon: Users },
};

const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  URGENT: { label: "Urgent", tone: "red" },
  HIGH: { label: "High", tone: "amber" },
  MEDIUM: { label: "Medium", tone: "blue" },
  LOW: { label: "Low", tone: "gray" },
};

interface FollowUpsViewProps {
  refreshKey: number;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}

/** Feature List §10 — Follow-ups & Tasks, against `GET /follow-ups`. */
export function FollowUpsView({ refreshKey, onChanged, onError }: FollowUpsViewProps) {
  const { user } = useSessionUser();
  const role = toRole(user?.role);
  const mayManage = role !== null && hasPermission(role, "followups.manage");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [assigneeId, setAssigneeId] = useState(ALL);
  const [dueWithin, setDueWithin] = useState(ALL);
  const [campaignId, setCampaignId] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [sort, setSort] = useState<"dueAt" | "priority" | "createdAt">("dueAt");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ApiFollowUp[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const debouncedSearch = useDebounced(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await followUpsApi.list({
        search: debouncedSearch.trim() || undefined,
        status: status === ALL ? undefined : [status as DerivedFollowUpStatus],
        assigneeId: assigneeId === ALL ? undefined : assigneeId,
        campaignId: campaignId === ALL ? undefined : campaignId,
        priority: priority === ALL ? undefined : [priority as Priority],
        dueWithin: dueWithin === ALL ? undefined : (dueWithin as "today"),
        sort,
        direction: sort === "priority" ? "desc" : "asc",
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setSelectedId((current) =>
        current && result.data.some((r) => r.id === current)
          ? current
          : (result.data[0]?.id ?? null),
      );
      // Drop selections for rows that are no longer on screen, so a bulk action can never
      // silently act on something the user can't see.
      setChecked((current) => {
        const visible = new Set(result.data.map((r) => r.id));
        const next = new Set(Array.from(current).filter((id) => visible.has(id)));
        return next.size === current.size ? current : next;
      });
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not reach the server. Check that the API is running.",
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, assigneeId, campaignId, priority, dueWithin, sort, page]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    usersApi
      .list({ status: ["ACTIVE"] })
      .then(setMembers)
      .catch(() => undefined);
    campaignsApi
      .list({ pageSize: 50 })
      .then((result) => setCampaigns(result.data))
      .catch(() => undefined);
  }, []);

  const withReset = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const clearAll = () => {
    setSearch("");
    setStatus(ALL);
    setAssigneeId(ALL);
    setDueWithin(ALL);
    setCampaignId(ALL);
    setPriority(ALL);
    setPage(1);
  };

  const filtersActive =
    search !== "" || [status, assigneeId, dueWithin, campaignId, priority].some((v) => v !== ALL);

  const selected = rows.find((r) => r.id === selectedId);
  const openRows = rows.filter((r) => r.status === "PENDING");
  const allOpenChecked = openRows.length > 0 && openRows.every((r) => checked.has(r.id));

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function completeChecked() {
    const ids = Array.from(checked);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const { completed } = await followUpsApi.completeMany(ids);
      setChecked(new Set());
      onChanged(
        completed === ids.length
          ? `Marked ${completed} follow-up${completed === 1 ? "" : "s"} complete.`
          : `Marked ${completed} complete — the rest were already done.`,
      );
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : "Could not complete those follow-ups.");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_372px]">
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <SearchInput
            value={search}
            onChange={withReset(setSearch)}
            placeholder="Search by lead, contact, city, phone or note..."
            className="w-full"
          />

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Status"
              value={status}
              onChange={withReset(setStatus)}
              className="w-[130px] flex-1"
              options={[
                { value: ALL, label: "All Statuses" },
                ...Object.entries(STATUS).map(([value, { label }]) => ({ value, label })),
              ]}
            />
            <FilterSelect
              label="Due"
              value={dueWithin}
              onChange={withReset(setDueWithin)}
              className="w-[120px] flex-1"
              options={[
                { value: ALL, label: "Any time" },
                { value: "today", label: "Today" },
                { value: "tomorrow", label: "Tomorrow" },
                { value: "week", label: "This week" },
                { value: "past", label: "In the past" },
              ]}
            />
            <FilterSelect
              label="Priority"
              value={priority}
              onChange={withReset(setPriority)}
              className="w-[120px] flex-1"
              options={[
                { value: ALL, label: "Any" },
                ...Object.entries(PRIORITY).map(([value, { label }]) => ({ value, label })),
              ]}
            />
            <FilterSelect
              label="Assigned to"
              value={assigneeId}
              onChange={withReset(setAssigneeId)}
              className="w-[150px] flex-1"
              options={[
                { value: ALL, label: "Anyone" },
                ...members.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
            <FilterSelect
              label="Campaign"
              value={campaignId}
              onChange={withReset(setCampaignId)}
              className="w-[150px] flex-1"
              options={[
                { value: ALL, label: "All Campaigns" },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <FilterSelect
              label="Sort by"
              value={sort}
              onChange={(value) => {
                setSort(value as typeof sort);
                setPage(1);
              }}
              className="w-[130px] flex-1"
              options={[
                { value: "dueAt", label: "Due date" },
                { value: "priority", label: "Priority" },
                { value: "createdAt", label: "Newest" },
              ]}
            />
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 text-[13px] font-semibold text-accent-blue transition-colors hover:underline"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              Clear
            </button>
          </div>
        </div>

        {mayManage && checked.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-accent-blue/[0.05] px-4 py-2.5">
            <p className="text-[13px] font-medium text-brand-navy">
              {checked.size} selected
              <button
                type="button"
                onClick={() => setChecked(new Set())}
                className="ml-2 font-semibold text-accent-blue hover:underline"
              >
                Clear
              </button>
            </p>
            <button
              type="button"
              onClick={() => void completeChecked()}
              disabled={bulkBusy}
              className="inline-flex h-9 items-center gap-2 rounded-btn bg-brand-green px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
            >
              {bulkBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.4} />
              )}
              Mark complete
            </button>
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="divide-y divide-slate-100" aria-busy="true">
            <span className="sr-only">Loading follow-ups</span>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-2 px-4 py-4">
                <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
                <div className="h-2.5 w-72 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        )}

        {error && rows.length === 0 && (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-brand-navy">
              Could not load follow-ups.
            </p>
            <p className="mt-1 text-[12.5px] text-slate-500">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 inline-flex h-9 items-center rounded-btn border border-slate-200 px-4 text-[13px] font-semibold text-accent-blue transition-colors hover:bg-slate-50"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-brand-navy">
              {filtersActive ? "No follow-ups match these filters." : "Nothing to follow up."}
            </p>
            <p className="mt-1 text-[12.5px] text-slate-500">
              Follow-ups are booked after a call — by the AI, or by whoever made it.
            </p>
            {filtersActive && (
              <button
                type="button"
                onClick={clearAll}
                className="mt-2 text-[13px] font-semibold text-accent-blue hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {mayManage && openRows.length > 0 && (
              <label className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-2 text-[12px] font-medium text-slate-500">
                <input
                  type="checkbox"
                  checked={allOpenChecked}
                  onChange={() =>
                    setChecked(allOpenChecked ? new Set() : new Set(openRows.map((r) => r.id)))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-accent-blue focus:ring-accent-blue"
                />
                Select the {openRows.length} open follow-up
                {openRows.length === 1 ? "" : "s"} on this page
              </label>
            )}

            <ul className="divide-y divide-slate-100">
              {rows.map((row) => {
                const state = STATUS[row.derivedStatus];
                const channel = CHANNEL[row.channel];
                const ChannelIcon = channel.icon;

                return (
                  <li
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 px-4 py-3.5 transition-colors",
                      row.id === selectedId ? "bg-accent-blue/[0.06]" : "hover:bg-slate-50/70",
                    )}
                  >
                    {mayManage && (
                      <input
                        type="checkbox"
                        checked={checked.has(row.id)}
                        disabled={row.status !== "PENDING"}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select follow-up for ${row.lead?.name ?? "lead"}`}
                        className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-accent-blue focus:ring-accent-blue disabled:opacity-30"
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {row.lead ? (
                          <Link
                            href={`/leads/${row.lead.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="min-w-0 flex-1 truncate text-[13px] font-semibold text-brand-navy hover:text-accent-blue hover:underline"
                          >
                            {row.lead.name}
                          </Link>
                        ) : (
                          <span className="min-w-0 flex-1 text-[13px] text-slate-400">—</span>
                        )}
                        <Badge tone={state.tone}>{state.label}</Badge>
                        <Badge tone={PRIORITY[row.priority].tone}>
                          {PRIORITY[row.priority].label}
                        </Badge>
                      </div>

                      <p className="tabular mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
                        <ChannelIcon className="h-3 w-3" strokeWidth={2} />
                        <span>{channel.label}</span>
                        <span>· due {formatDateTime(row.dueAt)}</span>
                        {row.assignee && <span>· {row.assignee.name}</span>}
                        {row.isAiGenerated && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-purple/[0.12] px-1.5 py-0.5 font-semibold text-accent-purple">
                            <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
                            AI
                          </span>
                        )}
                      </p>

                      {row.notes && (
                        <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-slate-600">
                          {row.notes}
                        </p>
                      )}
                    </div>

                    {row.lead && (
                      <div className="hidden shrink-0 sm:block">
                        <LeadStatusBadge status={row.lead.status} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="tabular text-[12.5px] text-slate-500">
            {total === 0
              ? "No follow-ups"
              : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                  page * PAGE_SIZE,
                  total,
                )} of ${formatNumber(total)} follow-ups`}
          </p>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </Card>

      {selected && (
        <div className="xl:sticky xl:top-6">
          <FollowUpPanel
            key={selected.id}
            followUp={selected}
            members={members}
            mayManage={mayManage}
            onChanged={(message) => {
              onChanged(message);
              void load();
            }}
            onError={onError}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}

function FollowUpPanel({
  followUp,
  members,
  mayManage,
  onChanged,
  onError,
  onClose,
}: {
  followUp: ApiFollowUp;
  members: WorkspaceMember[];
  mayManage: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [dueAt, setDueAt] = useState(toLocalInput(followUp.dueAt));
  const [assigneeId, setAssigneeId] = useState(followUp.assigneeId ?? "");
  const [channel, setChannel] = useState<FollowUpChannel>(followUp.channel);
  const [priority, setPriority] = useState<Priority>(followUp.priority);
  const [notes, setNotes] = useState(followUp.notes ?? "");
  const [saving, setSaving] = useState(false);

  const state = STATUS[followUp.derivedStatus];
  const open = followUp.status === "PENDING";

  const dirty =
    dueAt !== toLocalInput(followUp.dueAt) ||
    (assigneeId || null) !== followUp.assigneeId ||
    channel !== followUp.channel ||
    priority !== followUp.priority ||
    notes !== (followUp.notes ?? "");

  async function save() {
    setSaving(true);
    try {
      await followUpsApi.update(followUp.id, {
        dueAt: new Date(dueAt).toISOString(),
        assigneeId: assigneeId || null,
        channel,
        priority,
        notes,
      });
      onChanged("Follow-up saved.");
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : "Could not save the follow-up.");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: "COMPLETED" | "CANCELLED" | "PENDING", message: string) {
    setSaving(true);
    try {
      await followUpsApi.update(followUp.id, { status });
      onChanged(message);
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : "Could not update the follow-up.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this follow-up? This cannot be undone.")) return;
    try {
      await followUpsApi.remove(followUp.id);
      onChanged("Follow-up deleted.");
      onClose();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : "Could not delete the follow-up.");
    }
  }

  return (
    <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-bold tracking-tight text-brand-navy">
            {followUp.lead?.name ?? "Follow-up"}
          </h2>
          <p className="tabular mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-500">
            <Badge tone={state.tone}>{state.label}</Badge>
            <span>due {formatDateTime(followUp.dueAt)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close follow-up"
          className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {followUp.lead && (
          <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
            <Stat label="Contact" value={followUp.lead.contactPerson ?? "—"} />
            <Stat label="Phone" value={followUp.lead.phone} />
            <Stat label="City" value={followUp.lead.city ?? "—"} />
            <Stat label="Score" value={String(followUp.lead.score)} />
          </dl>
        )}

        {mayManage ? (
          <div className="space-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Due</span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="tabular h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Channel</span>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as FollowUpChannel)}
                  className="h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
                >
                  {Object.entries(CHANNEL).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                  Priority
                </span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
                >
                  {Object.entries(PRIORITY).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                Assigned to
              </span>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="What needs to happen on this call..."
                className="scrollbar-thin w-full resize-y rounded-lg border border-slate-200 bg-surface p-2.5 text-[12.5px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
              />
            </label>

            {dirty && (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-btn bg-accent-blue text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8] disabled:bg-slate-200 disabled:text-slate-400"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
                Save changes
              </button>
            )}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Channel" value={CHANNEL[followUp.channel].label} />
            <Stat label="Priority" value={PRIORITY[followUp.priority].label} />
            <Stat label="Assigned to" value={followUp.assignee?.name ?? "Unassigned"} />
            <Stat
              label="Reminder"
              value={followUp.remindAt ? formatDateTime(followUp.remindAt) : "None"}
            />
            {followUp.notes && (
              <div className="col-span-2">
                <dt className="text-[11px] text-slate-500">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700">
                  {followUp.notes}
                </dd>
              </div>
            )}
          </dl>
        )}

        {followUp.call && (
          <section className="mt-5">
            <h3 className="text-[13px] font-bold text-brand-navy">The call that booked this</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
              <Stat
                label="When"
                value={followUp.call.startedAt ? formatDateTime(followUp.call.startedAt) : "—"}
              />
              <Stat
                label="Duration"
                value={
                  followUp.call.durationSeconds
                    ? formatDuration(followUp.call.durationSeconds)
                    : "—"
                }
              />
              <Stat
                label="Outcome"
                value={followUp.call.outcome ? CALL_OUTCOME[followUp.call.outcome].label : "—"}
              />
              <Stat label="Agent" value={followUp.call.aiAgent?.name ?? "—"} />
            </dl>
          </section>
        )}

        {followUp.campaign && (
          <p className="mt-3 text-[12.5px] text-slate-600">
            Campaign:{" "}
            <Link
              href={`/campaigns/${followUp.campaign.id}`}
              className="font-semibold text-accent-blue hover:underline"
            >
              {followUp.campaign.name}
            </Link>
          </p>
        )}

        {followUp.completedAt && (
          <p className="tabular mt-3 text-[12.5px] text-deep-green">
            Completed {formatDateTime(followUp.completedAt)}
          </p>
        )}
      </div>

      {mayManage && (
        <div className="shrink-0 border-t border-slate-100 p-4">
          {open ? (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => void setStatus("CANCELLED", "Follow-up cancelled.")}
                disabled={saving}
                className="flex h-10 items-center justify-center gap-2 rounded-btn border border-slate-200 text-[13px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <CalendarClock className="h-3.5 w-3.5" strokeWidth={2.2} />
                Cancel it
              </button>
              <button
                type="button"
                onClick={() => void setStatus("COMPLETED", "Follow-up completed.")}
                disabled={saving}
                className="flex h-10 items-center justify-center gap-2 rounded-btn bg-brand-green text-[13px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
              >
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                Complete
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => void remove()}
                className="flex h-10 items-center justify-center gap-2 rounded-btn border border-alert-red/50 text-[13px] font-semibold text-alert-red transition-colors hover:bg-alert-red/[0.07]"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                Delete
              </button>
              <button
                type="button"
                onClick={() => void setStatus("PENDING", "Follow-up reopened.")}
                disabled={saving}
                className="flex h-10 items-center justify-center gap-2 rounded-btn border border-slate-200 text-[13px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
                Reopen
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="tabular truncate text-[12.5px] font-semibold text-brand-navy">{value}</dd>
    </div>
  );
}

/**
 * An ISO instant as `<input type="datetime-local">` wants it: the viewer's wall clock,
 * with no zone marker. `toISOString().slice(0, 16)` is the usual shortcut and is wrong —
 * it hands the field a UTC time, so anyone not on UTC sees the wrong hour and saving it
 * back silently shifts the follow-up by their offset.
 */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
