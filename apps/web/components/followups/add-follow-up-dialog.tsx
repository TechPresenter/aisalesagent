"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  followUpsApi,
  leadsApi,
  usersApi,
  type ApiLead,
  type FollowUpChannel,
  type Priority,
  type WorkspaceMember,
} from "@/lib/api-client";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

const CHANNELS: { value: FollowUpChannel; label: string }[] = [
  { value: "CALL", label: "Call" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Meeting" },
];

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const REMINDERS: { value: string; label: string }[] = [
  { value: "", label: "No reminder" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

/** Books a follow-up against a lead. Feature List §10. */
export function AddFollowUpDialog({
  open,
  onClose,
  onCreated,
  lead: fixedLead,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
  lead?: { id: string; name: string };
}) {
  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<ApiLead[]>([]);
  const [searching, setSearching] = useState(false);
  const [lead, setLead] = useState<{ id: string; name: string } | null>(fixedLead ?? null);

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const [channel, setChannel] = useState<FollowUpChannel>("CALL");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [assigneeId, setAssigneeId] = useState("");
  const [reminder, setReminder] = useState("30");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebounced(leadQuery, 300);

  useEffect(() => {
    if (!open) return;
    setLead(fixedLead ?? null);
    setLeadQuery("");
    setDueAt(defaultDueAt());
    setChannel("CALL");
    setPriority("MEDIUM");
    setAssigneeId("");
    setReminder("30");
    setNotes("");
    setError(null);
  }, [open, fixedLead]);

  useEffect(() => {
    if (!open) return;
    usersApi
      .list({ status: ["ACTIVE"] })
      .then(setMembers)
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open || fixedLead || lead) return;
    let cancelled = false;
    setSearching(true);
    leadsApi
      .list({ search: debouncedQuery.trim() || undefined, pageSize: 6 })
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
  }, [open, debouncedQuery, fixedLead, lead]);

  async function submit() {
    if (!lead || !dueAt) return;
    setSaving(true);
    setError(null);
    try {
      const due = new Date(dueAt);
      await followUpsApi.create({
        leadId: lead.id,
        dueAt: due.toISOString(),
        channel,
        priority,
        assigneeId: assigneeId || undefined,
        notes: notes.trim() || undefined,
        remindAt: reminder
          ? new Date(due.getTime() - Number(reminder) * 60_000).toISOString()
          : undefined,
      });
      onCreated(`Follow-up booked for ${lead.name}.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not book the follow-up.");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = Boolean(lead) && Boolean(dueAt) && !saving;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add follow-up"
      description="Follow-ups sit in the queue until someone completes them."
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
            className="inline-flex h-10 items-center gap-2 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
            Book follow-up
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
        {!fixedLead && (
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Lead</span>
            {lead ? (
              <div className="flex items-center justify-between gap-3 rounded-btn border border-brand-green/40 bg-brand-green/[0.07] px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold text-deep-green">
                  <Check className="h-4 w-4 shrink-0" strokeWidth={2.6} />
                  <span className="truncate">{lead.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setLead(null)}
                  className="shrink-0 text-[12.5px] font-semibold text-accent-blue hover:underline"
                >
                  Change
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
                    placeholder="Search leads by name, contact or phone..."
                    aria-label="Search leads"
                    className="h-10 w-full rounded-btn border border-slate-200 bg-surface pl-9 pr-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
                  />
                </div>

                <ul className="mt-2 max-h-52 overflow-y-auto rounded-btn border border-slate-200">
                  {searching && leadResults.length === 0 && (
                    <li className="px-3 py-3 text-[12.5px] text-slate-500">Searching...</li>
                  )}
                  {!searching && leadResults.length === 0 && (
                    <li className="px-3 py-3 text-[12.5px] text-slate-500">
                      No leads match that search.
                    </li>
                  )}
                  {leadResults.map((candidate, index) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={() => setLead({ id: candidate.id, name: candidate.name })}
                        className={cn(
                          "block w-full px-3 py-2.5 text-left transition-colors hover:bg-slate-50",
                          index > 0 && "border-t border-slate-100",
                        )}
                      >
                        <span className="block truncate text-[13px] font-semibold text-brand-navy">
                          {candidate.name}
                        </span>
                        <span className="tabular block truncate text-[11.5px] text-slate-500">
                          {[candidate.contactPerson, candidate.phone, candidate.city]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Due</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="tabular h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Remind me</span>
            <select
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              {REMINDERS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Channel</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as FollowUpChannel)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              {CHANNELS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Priority</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              {PRIORITIES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Assign to</span>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              <option value="">The lead&apos;s owner</option>
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="What needs to happen on this call..."
            className="scrollbar-thin w-full resize-y rounded-lg border border-slate-200 bg-surface p-3 text-[13px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
          />
        </label>
      </div>
    </Modal>
  );
}

/** Tomorrow at 10:00 in the viewer's own timezone, formatted for `datetime-local`. */
function defaultDueAt(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
