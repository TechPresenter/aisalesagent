"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  calendarApi,
  leadsApi,
  usersApi,
  type ApiLead,
  type CalendarEventType,
  type WorkspaceMember,
} from "@/lib/api-client";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

const TYPES: { value: CalendarEventType; label: string }[] = [
  { value: "MEETING", label: "Meeting" },
  { value: "DEMO", label: "Demo" },
  { value: "CALL", label: "Call" },
  { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "REMINDER", label: "Reminder" },
];

const DURATIONS = [15, 30, 45, 60, 90, 120];

/** Books an event. Feature List §11. */
export function AddEventDialog({
  open,
  onClose,
  onCreated,
  defaultDay,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
  /** The cell the user double-clicked, if any. */
  defaultDay?: Date | null;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CalendarEventType>("MEETING");
  const [startAt, setStartAt] = useState("");
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<ApiLead[]>([]);
  const [searching, setSearching] = useState(false);
  const [lead, setLead] = useState<{ id: string; name: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebounced(leadQuery, 300);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setType("MEETING");
    setStartAt(defaultStart(defaultDay ?? undefined));
    setDuration(30);
    setLocation("");
    setDescription("");
    setOwnerId("");
    setLead(null);
    setLeadQuery("");
    setError(null);
  }, [open, defaultDay]);

  useEffect(() => {
    if (!open) return;
    usersApi
      .list({ status: ["ACTIVE"] })
      .then(setMembers)
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open || lead) return;
    let cancelled = false;
    setSearching(true);
    leadsApi
      .list({ search: debouncedQuery.trim() || undefined, pageSize: 5 })
      .then((result) => {
        if (!cancelled) setLeadResults(result.data);
      })
      .catch(() => {
        if (!cancelled) setLeadResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedQuery, lead]);

  async function submit() {
    if (!title.trim() || !startAt) return;
    setSaving(true);
    setError(null);
    try {
      const start = new Date(startAt);
      await calendarApi.create({
        title: title.trim(),
        type,
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + duration * 60_000).toISOString(),
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        ownerId: ownerId || undefined,
        leadId: lead?.id,
      });
      onCreated(`"${title.trim()}" added to the calendar.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save the event.");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = title.trim().length > 0 && Boolean(startAt) && !saving;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add event"
      description="Meetings, demos and reminders. Linking a lead puts it on their record."
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
            disabled={!canSubmit}
            className="inline-flex h-10 items-center gap-2 rounded-btn bg-accent-blue px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#1B6CD8] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
            Add event
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
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Demo — Helix Diagnostics"
            className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Starts</span>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="tabular h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Length</span>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              {DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CalendarEventType)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              {TYPES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
            Lead <span className="text-slate-400">(optional)</span>
          </span>
          {lead ? (
            <div className="flex items-center justify-between gap-3 rounded-btn border border-brand-green/40 bg-brand-green/[0.07] px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold text-deep-green">
                <Check className="h-4 w-4 shrink-0" strokeWidth={2.6} />
                <span className="truncate">{lead.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setLead(null)}
                aria-label="Remove lead"
                className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  strokeWidth={2}
                />
                <input
                  value={leadQuery}
                  onChange={(e) => setLeadQuery(e.target.value)}
                  placeholder="Search leads..."
                  aria-label="Search leads"
                  className="h-10 w-full rounded-btn border border-slate-200 bg-surface pl-9 pr-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
                />
              </div>
              {leadQuery.trim().length > 0 && (
                <ul className="mt-2 max-h-44 overflow-y-auto rounded-btn border border-slate-200">
                  {searching && leadResults.length === 0 && (
                    <li className="px-3 py-2.5 text-[12.5px] text-slate-500">Searching...</li>
                  )}
                  {!searching && leadResults.length === 0 && (
                    <li className="px-3 py-2.5 text-[12.5px] text-slate-500">
                      No leads match that search.
                    </li>
                  )}
                  {leadResults.map((candidate, index) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setLead({ id: candidate.id, name: candidate.name });
                          if (!title.trim()) setTitle(`Meeting — ${candidate.name}`);
                        }}
                        className={cn(
                          "block w-full px-3 py-2 text-left transition-colors hover:bg-slate-50",
                          index > 0 && "border-t border-slate-100",
                        )}
                      >
                        <span className="block truncate text-[13px] font-semibold text-brand-navy">
                          {candidate.name}
                        </span>
                        <span className="tabular block truncate text-[11.5px] text-slate-500">
                          {[candidate.contactPerson, candidate.phone].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Location</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={300}
              placeholder="Zoom, their office..."
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Owner</span>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              <option value="">Me</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
            Notes <span className="text-slate-400">(optional)</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Agenda, who is joining, what to prepare..."
            className="scrollbar-thin w-full resize-y rounded-lg border border-slate-200 bg-surface p-3 text-[13px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
          />
        </label>
      </div>
    </Modal>
  );
}

/**
 * The next round hour on the given day — or, if none was given, on today.
 *
 * Formatted for `datetime-local`, which wants the viewer's wall clock with no zone
 * marker; `toISOString().slice(0, 16)` would hand it UTC and silently shift the event.
 */
function defaultStart(day?: Date): string {
  const date = day ? new Date(day) : new Date();
  if (day) date.setHours(10, 0, 0, 0);
  else date.setHours(date.getHours() + 1, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
