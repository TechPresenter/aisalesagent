"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  leadsApi,
  notesApi,
  type ApiLead,
  type NoteType,
  type Sentiment,
} from "@/lib/api-client";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

const TYPES: { value: NoteType; label: string }[] = [
  { value: "GENERAL", label: "General" },
  { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "PRICING", label: "Pricing" },
  { value: "DEMO", label: "Demo" },
  { value: "OBJECTION", label: "Objection" },
  { value: "INQUIRY", label: "Inquiry" },
  { value: "POSITIVE", label: "Positive" },
  { value: "NEGATIVE", label: "Negative" },
];

const SENTIMENTS: { value: Sentiment; label: string }[] = [
  { value: "POSITIVE", label: "Positive" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "NEGATIVE", label: "Negative" },
];

/**
 * Writes a note against a lead.
 *
 * A note has to belong to a lead — there is no "floating" note in the schema, because a
 * note nobody can find from the record it describes is not worth storing. So the lead
 * picker is the first field and the form cannot be submitted without one.
 */
export function AddNoteDialog({
  open,
  onClose,
  onCreated,
  lead: fixedLead,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
  /** Pre-selects (and hides) the lead picker — for opening this from a lead's own page. */
  lead?: { id: string; name: string };
}) {
  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<ApiLead[]>([]);
  const [searching, setSearching] = useState(false);
  const [lead, setLead] = useState<{ id: string; name: string } | null>(fixedLead ?? null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<NoteType>("GENERAL");
  const [sentiment, setSentiment] = useState<Sentiment | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebounced(leadQuery, 300);

  useEffect(() => {
    if (!open) return;
    setLead(fixedLead ?? null);
    setLeadQuery("");
    setTitle("");
    setContent("");
    setType("GENERAL");
    setSentiment("");
    setError(null);
  }, [open, fixedLead]);

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
    if (!lead || content.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await notesApi.create({
        leadId: lead.id,
        title: title.trim() || undefined,
        content: content.trim(),
        type,
        sentiment: sentiment === "" ? undefined : sentiment,
      });
      onCreated(`Note added to ${lead.name}.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = Boolean(lead) && content.trim().length > 0 && !saving;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add note"
      description="Notes are attached to a lead and appear on their timeline."
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
            Save note
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

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
            Title <span className="text-slate-400">(optional)</span>
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Pricing objection, budget approved..."
            className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Note</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="What happened, what was said, what happens next..."
            className="scrollbar-thin w-full resize-y rounded-lg border border-slate-200 bg-surface p-3 text-[13px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as NoteType)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              {TYPES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Sentiment</span>
            <select
              value={sentiment}
              onChange={(e) => setSentiment(e.target.value as Sentiment | "")}
              className="h-10 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
            >
              <option value="">Not set</option>
              {SENTIMENTS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}
