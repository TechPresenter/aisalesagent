"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-select";
import { Pagination } from "@/components/ui/pagination";
import { AgentAvatar } from "@/components/calls/call-status-badge";
import {
  ApiError,
  campaignsApi,
  transcriptsApi,
  type ApiCampaign,
  type ApiTranscript,
  type CallOutcome,
  type Sentiment,
  type TranscriptSegment,
} from "@/lib/api-client";
import { CALL_OUTCOME } from "@/lib/status";
import { cn, formatDateTime, formatDuration, formatNumber } from "@/lib/utils";

const ALL = "all";
const PAGE_SIZE = 12;

/** Sentiment tones follow the same semantic rule as everywhere else. */
const SENTIMENT: Record<Sentiment, { label: string; tone: "green" | "gray" | "red" }> = {
  POSITIVE: { label: "Positive", tone: "green" },
  NEUTRAL: { label: "Neutral", tone: "gray" },
  NEGATIVE: { label: "Negative", tone: "red" },
};

/**
 * Feature List §7 — Transcripts.
 *
 * The search reaches into the utterances, not just the summary, which is what makes this
 * screen different from Call History: the same calls, found by what was said. Matching
 * lines are shown under each result, so a hit explains itself rather than leaving the
 * reader to open the transcript and hunt.
 */
export function TranscriptsView() {
  const [search, setSearch] = useState("");
  const [sentiment, setSentiment] = useState(ALL);
  const [outcome, setOutcome] = useState(ALL);
  const [campaignId, setCampaignId] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [rows, setRows] = useState<ApiTranscript[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await transcriptsApi.list({
        search: search.trim() || undefined,
        sentiment: sentiment === ALL ? undefined : [sentiment as Sentiment],
        outcome: outcome === ALL ? undefined : [outcome as CallOutcome],
        campaignId: campaignId === ALL ? undefined : campaignId,
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setSelectedId((current) =>
        current && result.data.some((t) => t.id === current)
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
  }, [search, sentiment, outcome, campaignId, page]);

  useEffect(() => {
    void load();
  }, [load]);

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
    setSentiment(ALL);
    setOutcome(ALL);
    setCampaignId(ALL);
    setPage(1);
  };

  const filtersActive =
    search !== "" || [sentiment, outcome, campaignId].some((v) => v !== ALL);
  const selected = rows.find((t) => t.id === selectedId);

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_392px]">
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <SearchInput
            value={search}
            onChange={withReset(setSearch)}
            placeholder="Search what was said — a phrase, an objection, a competitor..."
            className="w-full"
          />

          <div className="mt-4 flex flex-wrap items-end gap-3">
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
              label="Outcome"
              value={outcome}
              onChange={withReset(setOutcome)}
              className="w-[150px] flex-1"
              options={[
                { value: ALL, label: "All Outcomes" },
                ...Object.entries(CALL_OUTCOME).map(([value, { label }]) => ({ value, label })),
              ]}
            />
            <FilterSelect
              label="Campaign"
              value={campaignId}
              onChange={withReset(setCampaignId)}
              className="w-[170px] flex-1"
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
            <span className="sr-only">Loading transcripts</span>
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
            <p className="text-[13.5px] font-medium text-brand-navy">
              Could not load transcripts.
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
              {filtersActive ? "Nothing matches this search." : "No transcripts yet."}
            </p>
            <p className="mt-1 text-[12.5px] text-slate-500">
              {filtersActive
                ? "Transcripts are searched by what was actually said on the call."
                : "Transcripts appear once calls complete with transcription enabled."}
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
            {rows.map((transcript) => {
              const call = transcript.call;
              const outcomeInfo = call?.outcome ? CALL_OUTCOME[call.outcome] : null;
              const sentimentInfo = transcript.sentiment
                ? SENTIMENT[transcript.sentiment]
                : null;

              return (
                <li
                  key={transcript.id}
                  onClick={() => setSelectedId(transcript.id)}
                  className={cn(
                    "cursor-pointer px-4 py-3.5 transition-colors",
                    transcript.id === selectedId
                      ? "bg-accent-blue/[0.06]"
                      : "hover:bg-slate-50/70",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-brand-navy">
                      {call?.lead?.name ?? call?.phone ?? "Unknown"}
                    </span>
                    {sentimentInfo && (
                      <Badge tone={sentimentInfo.tone}>{sentimentInfo.label}</Badge>
                    )}
                    {outcomeInfo && <Badge tone={outcomeInfo.tone}>{outcomeInfo.label}</Badge>}
                  </div>

                  <p className="tabular mt-0.5 text-[11.5px] text-slate-500">
                    {call?.startedAt ? formatDateTime(call.startedAt) : "—"}
                    {call?.aiAgent && ` · ${call.aiAgent.name}`}
                    {call?.durationSeconds ? ` · ${formatDuration(call.durationSeconds)}` : ""}
                    {transcript.segmentCount !== undefined &&
                      ` · ${transcript.segmentCount} line${transcript.segmentCount === 1 ? "" : "s"}`}
                  </p>

                  {/* Why this row matched. Without it a search just makes the list
                      shorter and leaves the reader to guess. */}
                  {transcript.matches && transcript.matches.length > 0 && (
                    <ul className="mt-2 space-y-1 border-l-2 border-accent-blue/30 pl-3">
                      {transcript.matches.map((match) => (
                        <li key={match.segmentId} className="text-[12px] leading-snug">
                          <span className="tabular mr-1.5 text-slate-400">
                            {formatDuration(Math.round(match.startMs / 1000))}
                          </span>
                          <span className="font-medium text-brand-navy">
                            {match.speakerLabel}:
                          </span>{" "}
                          <Highlight text={match.text} term={search.trim()} />
                        </li>
                      ))}
                    </ul>
                  )}

                  {!transcript.matches?.length && transcript.summary && (
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-slate-600">
                      {transcript.summary}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="tabular text-[12.5px] text-slate-500">
            {total === 0
              ? "No transcripts"
              : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                  page * PAGE_SIZE,
                  total,
                )} of ${formatNumber(total)} transcripts`}
          </p>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </Card>

      {selected && (
        <div className="xl:sticky xl:top-6">
          <TranscriptPanel key={selected.id} transcript={selected} searchTerm={search.trim()} />
        </div>
      )}
    </div>
  );
}

type Tab = "transcript" | "summary";

function TranscriptPanel({
  transcript,
  searchTerm,
}: {
  transcript: ApiTranscript;
  searchTerm: string;
}) {
  const [tab, setTab] = useState<Tab>("transcript");
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    transcriptsApi
      .segments(transcript.id)
      .then((rows) => {
        if (!cancelled) setSegments(rows);
      })
      .catch(() => {
        if (!cancelled) setSegments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [transcript.id]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const call = transcript.call;

  async function copy() {
    try {
      const text = await transcriptsApi.text(transcript.id);
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access is denied outside a secure context; the download beside this
      // is the fallback, so failing quietly beats an alert.
    }
  }

  async function download() {
    try {
      const text = await transcriptsApi.text(transcript.id);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(call?.lead?.name ?? "transcript")
        .replace(/\s+/g, "-")
        .toLowerCase()}-transcript.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      /* nothing useful to show */
    }
  }

  return (
    <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-100 px-5 pt-4">
        <h2 className="truncate text-[16px] font-bold tracking-tight text-brand-navy">
          {call?.lead?.name ?? call?.phone ?? "Transcript"}
        </h2>
        <p className="tabular mt-0.5 text-[12.5px] text-slate-500">
          {call?.startedAt ? formatDateTime(call.startedAt) : "—"}
          {call?.durationSeconds ? ` · ${formatDuration(call.durationSeconds)}` : ""}
        </p>

        {/* A confidence of zero is the sandbox telling the truth about itself; saying so
            is better than rendering placeholder text as though it were transcription. */}
        {transcript.confidence === 0 && (
          <p className="mt-2 rounded-btn bg-warning-amber/[0.1] px-2.5 py-1.5 text-[11.5px] text-[#B4761A]">
            This transcript came from the sandbox, not a speech-to-text provider.
          </p>
        )}

        <div role="tablist" className="mt-3 flex gap-1">
          {(["transcript", "summary"] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px flex-1 border-b-2 px-2 pb-2.5 pt-1 text-[13px] font-semibold capitalize transition-colors",
                tab === id
                  ? "border-accent-blue text-accent-blue"
                  : "border-transparent text-slate-500 hover:text-brand-navy",
              )}
            >
              {id === "summary" ? "AI Summary" : "Transcript"}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "transcript" && (
          <>
            {segments === null && (
              <div className="space-y-2" aria-busy="true">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            )}
            {segments?.length === 0 && (
              <p className="py-6 text-center text-[12.5px] text-slate-500">
                This transcript has no lines.
              </p>
            )}
            {segments && segments.length > 0 && (
              <ul className="space-y-3.5">
                {segments.map((segment) => (
                  <li key={segment.id} className="flex gap-2.5">
                    <AgentAvatar
                      initial={segment.speaker === "AI_AGENT" ? "A" : "C"}
                      tone={segment.speaker === "AI_AGENT" ? "blue" : "gray"}
                      size={24}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="tabular shrink-0 text-[11px] text-slate-400">
                          {formatDuration(Math.round(segment.startMs / 1000))}
                        </span>
                        <span className="text-[12.5px] font-bold text-brand-navy">
                          {segment.speakerLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-600">
                        <Highlight text={segment.text} term={searchTerm} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "summary" && (
          <>
            {transcript.summary ? (
              <p className="text-[12.5px] leading-relaxed text-slate-600">{transcript.summary}</p>
            ) : (
              <p className="py-6 text-center text-[12.5px] text-slate-500">
                No AI analysis has run on this call.
              </p>
            )}

            {transcript.sentiment && (
              <div className="mt-4 flex items-center gap-2">
                <Badge tone={SENTIMENT[transcript.sentiment].tone}>
                  {SENTIMENT[transcript.sentiment].label}
                </Badge>
                {transcript.analysedAt && (
                  <span className="text-[11.5px] text-slate-400">
                    Analysed {formatDateTime(transcript.analysedAt)}
                  </span>
                )}
              </div>
            )}

            {call?.campaign && (
              <p className="mt-4 text-[12.5px] text-slate-600">
                Campaign:{" "}
                <Link
                  href={`/campaigns/${call.campaign.id}`}
                  className="font-semibold text-accent-blue hover:underline"
                >
                  {call.campaign.name}
                </Link>
              </p>
            )}
            {call?.lead && (
              <p className="mt-1 text-[12.5px] text-slate-600">
                Lead:{" "}
                <Link
                  href={`/leads/${call.lead.id}`}
                  className="font-semibold text-accent-blue hover:underline"
                >
                  {call.lead.name}
                </Link>
              </p>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-4">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex h-10 items-center justify-center gap-2 rounded-btn border border-slate-200 text-[13px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-brand-green" strokeWidth={2.4} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => void download()}
            className="flex h-10 items-center justify-center gap-2 rounded-btn bg-accent-blue text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
            Download
          </button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Marks the searched phrase inside a line.
 *
 * Splits on the term rather than injecting HTML — building a string with `<mark>` in it
 * and rendering it raw would make any transcript containing markup an injection vector,
 * and a transcript is text someone said, which is exactly the kind of input not to trust.
 */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;

  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const parts: React.ReactNode[] = [];

  let cursor = 0;
  let index = lower.indexOf(needle);
  let key = 0;

  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <mark
        key={key++}
        className="rounded bg-warning-amber/30 px-0.5 text-brand-navy"
      >
        {text.slice(index, index + term.length)}
      </mark>,
    );
    cursor = index + term.length;
    index = lower.indexOf(needle, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
