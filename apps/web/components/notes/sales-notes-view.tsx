"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Pencil, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-select";
import { Pagination } from "@/components/ui/pagination";
import {
  ApiError,
  campaignsApi,
  notesApi,
  type ApiCampaign,
  type ApiNote,
  type NoteType,
  type Sentiment,
} from "@/lib/api-client";
import { CALL_OUTCOME } from "@/lib/status";
import { cn, formatDateTime, formatDuration, formatNumber } from "@/lib/utils";
import { toRole, useSessionUser } from "@/lib/use-session";
import { hasPermission } from "@appsgain/shared";
import type { Tone } from "@/lib/status";

const ALL = "all";
const PAGE_SIZE = 12;

/**
 * Note types and their tones.
 *
 * Brand Guidelines §3 reserves purple for AI-generated content, so no note *type* uses
 * it — the purple marker on this screen means "the AI wrote this", and giving a type the
 * same colour would make that signal ambiguous.
 */
const NOTE_TYPE: Record<NoteType, { label: string; tone: Tone }> = {
  GENERAL: { label: "General", tone: "gray" },
  FOLLOW_UP: { label: "Follow-up", tone: "blue" },
  PRICING: { label: "Pricing", tone: "amber" },
  DEMO: { label: "Demo", tone: "green" },
  OBJECTION: { label: "Objection", tone: "red" },
  INQUIRY: { label: "Inquiry", tone: "blue" },
  POSITIVE: { label: "Positive", tone: "green" },
  NEGATIVE: { label: "Negative", tone: "red" },
};

const SENTIMENT: Record<Sentiment, { label: string; tone: Tone }> = {
  POSITIVE: { label: "Positive", tone: "green" },
  NEUTRAL: { label: "Neutral", tone: "gray" },
  NEGATIVE: { label: "Negative", tone: "red" },
};

interface SalesNotesViewProps {
  /** Bumped by the screen when a note is created elsewhere, to force a reload. */
  refreshKey: number;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}

/** Feature List §9 — Sales Notes, against `GET /notes`. */
export function SalesNotesView({ refreshKey, onChanged, onError }: SalesNotesViewProps) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState(ALL);
  const [sentiment, setSentiment] = useState(ALL);
  const [campaignId, setCampaignId] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [rows, setRows] = useState<ApiNote[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await notesApi.list({
        search: search.trim() || undefined,
        type: type === ALL ? undefined : [type as NoteType],
        sentiment: sentiment === ALL ? undefined : [sentiment as Sentiment],
        campaignId: campaignId === ALL ? undefined : campaignId,
        aiOnly: source === ALL ? undefined : source === "ai",
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setSelectedId((current) =>
        current && result.data.some((n) => n.id === current)
          ? current
          : (result.data[0]?.id ?? null),
      );
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
  }, [search, type, sentiment, campaignId, source, page]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
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
    setType(ALL);
    setSentiment(ALL);
    setCampaignId(ALL);
    setSource(ALL);
    setPage(1);
  };

  const filtersActive =
    search !== "" || [type, sentiment, campaignId, source].some((v) => v !== ALL);
  const selected = rows.find((n) => n.id === selectedId);

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_392px]">
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <SearchInput
            value={search}
            onChange={withReset(setSearch)}
            placeholder="Search notes by keyword, company or contact..."
            className="w-full"
          />

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Type"
              value={type}
              onChange={withReset(setType)}
              className="w-[130px] flex-1"
              options={[
                { value: ALL, label: "All Types" },
                ...Object.entries(NOTE_TYPE).map(([value, { label }]) => ({ value, label })),
              ]}
            />
            <FilterSelect
              label="Sentiment"
              value={sentiment}
              onChange={withReset(setSentiment)}
              className="w-[140px] flex-1"
              options={[
                { value: ALL, label: "All Sentiments" },
                ...Object.entries(SENTIMENT).map(([value, { label }]) => ({ value, label })),
              ]}
            />
            <FilterSelect
              label="Written by"
              value={source}
              onChange={withReset(setSource)}
              className="w-[130px] flex-1"
              options={[
                { value: ALL, label: "Anyone" },
                { value: "ai", label: "AI" },
                { value: "human", label: "People" },
              ]}
            />
            <FilterSelect
              label="Campaign"
              value={campaignId}
              onChange={withReset(setCampaignId)}
              className="w-[160px] flex-1"
              options={[
                { value: ALL, label: "All Campaigns" },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
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

        {loading && rows.length === 0 && (
          <div className="divide-y divide-slate-100" aria-busy="true">
            <span className="sr-only">Loading notes</span>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-2 px-4 py-4">
                <div className="h-3 w-44 animate-pulse rounded bg-slate-100" />
                <div className="h-2.5 w-64 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        )}

        {error && rows.length === 0 && (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-brand-navy">Could not load notes.</p>
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
              {filtersActive ? "No notes match these filters." : "No notes yet."}
            </p>
            <p className="mt-1 text-[12.5px] text-slate-500">
              Notes are written after a call — by the AI, or by whoever made it.
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
          <ul className="divide-y divide-slate-100">
            {rows.map((note) => {
              const typeInfo = NOTE_TYPE[note.type];
              const sentimentInfo = note.sentiment ? SENTIMENT[note.sentiment] : null;

              return (
                <li
                  key={note.id}
                  onClick={() => setSelectedId(note.id)}
                  className={cn(
                    "cursor-pointer px-4 py-3.5 transition-colors",
                    note.id === selectedId ? "bg-accent-blue/[0.06]" : "hover:bg-slate-50/70",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {note.lead ? (
                      <Link
                        href={`/leads/${note.lead.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="min-w-0 flex-1 truncate text-[13px] font-semibold text-brand-navy hover:text-accent-blue hover:underline"
                      >
                        {note.lead.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 text-[13px] text-slate-400">—</span>
                    )}
                    <Badge tone={typeInfo.tone}>{typeInfo.label}</Badge>
                    {sentimentInfo && (
                      <Badge tone={sentimentInfo.tone}>{sentimentInfo.label}</Badge>
                    )}
                  </div>

                  <p className="tabular mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
                    <span>{formatDateTime(note.createdAt)}</span>
                    {/* The authorship marker. An AI note that a person has revised is
                          shown as theirs, because after an edit the words are. */}
                    {note.isAiGenerated ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-purple/[0.12] px-1.5 py-0.5 font-semibold text-accent-purple">
                        <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
                        AI
                      </span>
                    ) : (
                      note.author && <span>· {note.author.name}</span>
                    )}
                    {note.editedAt && <span>· edited</span>}
                  </p>

                  <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-slate-600">
                    {note.title ? <strong>{note.title}. </strong> : null}
                    {note.content}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="tabular text-[12.5px] text-slate-500">
            {total === 0
              ? "No notes"
              : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                  page * PAGE_SIZE,
                  total,
                )} of ${formatNumber(total)} notes`}
          </p>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </Card>

      {selected && (
        <div className="xl:sticky xl:top-6">
          <NoteDetailPanel
            key={selected.id}
            note={selected}
            onSaved={(message) => {
              onChanged(message);
              void load();
            }}
            onFailed={onError}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}

function NoteDetailPanel({
  note,
  onSaved,
  onFailed,
  onClose,
}: {
  note: ApiNote;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
  onClose: () => void;
}) {
  const { user } = useSessionUser();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(note.content);
  const [type, setType] = useState<NoteType>(note.type);
  const [sentiment, setSentiment] = useState<Sentiment | "">(note.sentiment ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    content !== note.content ||
    type !== note.type ||
    (sentiment || null) !== (note.sentiment ?? null);

  /* Mirrors NotesService.update / .remove exactly: `notes.edit` opens the screen's write
     controls at all, and beyond that a note a colleague wrote is theirs unless you also
     hold `notes.delete`. An AI note is nobody's, so anyone who can edit may take it over.
     Kept in step with the service by hand — the API is what enforces it either way, this
     only decides whether the button is worth showing. */
  const role = toRole(user?.role);
  const mayWrite = role !== null && hasPermission(role, "notes.edit");
  const isOwn = note.authorId !== null && note.authorId === user?.id;
  const mayTouchOthers = role !== null && hasPermission(role, "notes.delete");
  const mayEdit = mayWrite && (note.isAiGenerated || isOwn || mayTouchOthers);
  const mayDelete = mayWrite && (isOwn || mayTouchOthers);

  async function save() {
    setSaving(true);
    try {
      await notesApi.update(note.id, {
        content,
        type,
        sentiment: sentiment === "" ? undefined : sentiment,
      });
      setEditing(false);
      onSaved(
        note.isAiGenerated && content !== note.content
          ? "Note saved — it is now attributed to you rather than the AI."
          : "Note saved.",
      );
    } catch (cause) {
      onFailed(cause instanceof ApiError ? cause.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    try {
      await notesApi.remove(note.id);
      onSaved("Note deleted.");
      onClose();
    } catch (cause) {
      onFailed(cause instanceof ApiError ? cause.message : "Could not delete the note.");
    }
  }

  return (
    <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-bold tracking-tight text-brand-navy">
            {note.lead?.name ?? "Note"}
          </h2>
          <p className="tabular mt-0.5 text-[12px] text-slate-500">
            {formatDateTime(note.createdAt)}
            {note.isAiGenerated ? " · written by AI" : note.author ? ` · ${note.author.name}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close note"
          className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {note.isAiGenerated && (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-accent-purple/[0.07] p-2.5 text-[12px] leading-relaxed text-accent-purple">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            The AI wrote this from the call. Editing it makes it yours.
          </p>
        )}

        {editing ? (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              aria-label="Note content"
              className="scrollbar-thin w-full resize-y rounded-lg border border-slate-200 bg-surface p-3 text-[12.5px] leading-relaxed text-slate-700 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Type</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as NoteType)}
                  className="h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
                >
                  {Object.entries(NOTE_TYPE).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                  Sentiment
                </span>
                <select
                  value={sentiment}
                  onChange={(e) => setSentiment(e.target.value as Sentiment | "")}
                  className="h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
                >
                  <option value="">Not set</option>
                  {Object.entries(SENTIMENT).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700">
            {note.content}
          </p>
        )}

        {note.call && (
          <section className="mt-5">
            <h3 className="text-[13px] font-bold text-brand-navy">From this call</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
              <Stat
                label="When"
                value={note.call.startedAt ? formatDateTime(note.call.startedAt) : "—"}
              />
              <Stat
                label="Duration"
                value={note.call.durationSeconds ? formatDuration(note.call.durationSeconds) : "—"}
              />
              <Stat
                label="Outcome"
                value={note.call.outcome ? CALL_OUTCOME[note.call.outcome].label : "—"}
              />
              <Stat label="Agent" value={note.call.aiAgent?.name ?? "—"} />
            </dl>
          </section>
        )}

        {note.campaign && (
          <p className="mt-3 text-[12.5px] text-slate-600">
            Campaign:{" "}
            <Link
              href={`/campaigns/${note.campaign.id}`}
              className="font-semibold text-accent-blue hover:underline"
            >
              {note.campaign.name}
            </Link>
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-4">
        {editing ? (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setContent(note.content);
                setType(note.type);
                setSentiment(note.sentiment ?? "");
                setEditing(false);
              }}
              className="flex h-10 items-center justify-center rounded-btn border border-slate-200 text-[13px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty || content.trim().length === 0}
              className="flex h-10 items-center justify-center gap-2 rounded-btn bg-accent-blue text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8] disabled:bg-slate-200 disabled:text-slate-400"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
              Save
            </button>
          </div>
        ) : (
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: gridFor(mayEdit, mayDelete) }}
          >
            {mayDelete && (
              <button
                type="button"
                onClick={() => void remove()}
                className="flex h-10 items-center justify-center gap-2 rounded-btn border border-alert-red/50 text-[13px] font-semibold text-alert-red transition-colors hover:bg-alert-red/[0.07]"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                Delete
              </button>
            )}
            {mayEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex h-10 items-center justify-center gap-2 rounded-btn bg-accent-blue text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />
                Edit
              </button>
            )}
            {!mayEdit && !mayDelete && (
              <p className="text-[12.5px] text-slate-500">
                {mayWrite
                  ? "Someone else wrote this note, so only they can change it."
                  : "You have read-only access to notes."}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** One column, two columns, or a single explanatory line — whichever the user can act on. */
function gridFor(mayEdit: boolean, mayDelete: boolean): string {
  return mayEdit && mayDelete ? "1fr 1fr" : "1fr";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="tabular truncate text-[12.5px] font-semibold text-brand-navy">{value}</dd>
    </div>
  );
}
