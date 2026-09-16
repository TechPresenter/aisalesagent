"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Download, FileText, Play, RotateCcw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-select";
import { Pagination } from "@/components/ui/pagination";
import { Waveform } from "@/components/calls/waveform";
import {
  ApiError,
  campaignsApi,
  recordingsApi,
  type ApiCampaign,
  type ApiRecording,
} from "@/lib/api-client";
import { CALL_OUTCOME } from "@/lib/status";
import { cn, formatDateTime, formatDuration, formatNumber } from "@/lib/utils";

const ALL = "all";
const PAGE_SIZE = 12;

/** Feature List §8 — Recordings, against `GET /recordings`. */
export function RecordingsView() {
  const [search, setSearch] = useState("");
  const [campaignId, setCampaignId] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [rows, setRows] = useState<ApiRecording[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await recordingsApi.list({
        search: search.trim() || undefined,
        campaignId: campaignId === ALL ? undefined : campaignId,
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
  }, [search, campaignId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    campaignsApi
      .list({ pageSize: 50 })
      .then((result) => setCampaigns(result.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selected = rows.find((r) => r.id === selectedId);

  async function download(recording: ApiRecording) {
    try {
      const { url } = await recordingsApi.signedUrl(recording.id);
      window.open(url, "_blank", "noopener");
    } catch (cause) {
      setNotice(
        cause instanceof ApiError ? cause.message : "Could not create a download link.",
      );
    }
  }

  async function remove(recording: ApiRecording) {
    if (
      !window.confirm(
        `Delete this recording? The audio cannot be recovered.`,
      )
    ) {
      return;
    }
    try {
      await recordingsApi.remove(recording.id);
      setNotice("Recording deleted.");
      await load();
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "Could not delete the recording.");
    }
  }

  return (
    <>
      {notice && (
        <div role="status" className="mb-4 rounded-btn bg-slate-100 px-4 py-2.5 text-[13px] text-brand-navy">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_364px]">
        <Card className="flex min-w-0 flex-col overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="Search by number or company..."
                className="min-w-[220px] flex-1"
              />
              <FilterSelect
                label="Campaign"
                value={campaignId}
                onChange={(value) => {
                  setCampaignId(value);
                  setPage(1);
                }}
                className="w-[180px]"
                options={[
                  { value: ALL, label: "All Campaigns" },
                  ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setCampaignId(ALL);
                  setPage(1);
                }}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 text-[13px] font-semibold text-accent-blue transition-colors hover:underline"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                Clear
              </button>
            </div>
          </div>

          {loading && rows.length === 0 && (
            <div className="divide-y divide-slate-100" aria-busy="true">
              <span className="sr-only">Loading recordings</span>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-4">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-44 animate-pulse rounded bg-slate-100" />
                    <div className="h-2.5 w-28 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && rows.length === 0 && (
            <div className="px-5 py-14 text-center">
              <p className="text-[13.5px] font-medium text-brand-navy">
                Could not load recordings.
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
              <p className="text-[13.5px] font-medium text-brand-navy">No recordings yet.</p>
              <p className="mt-1 text-[12.5px] text-slate-500">
                Recordings appear here once calls complete with recording enabled.
              </p>
              <Link
                href="/ai-calling"
                className="mt-3 inline-flex h-9 items-center rounded-btn bg-accent-blue px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
              >
                Open the calling console
              </Link>
            </div>
          )}

          {rows.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {rows.map((recording) => {
                const outcome = recording.call?.outcome
                  ? CALL_OUTCOME[recording.call.outcome]
                  : null;

                return (
                  <li
                    key={recording.id}
                    onClick={() => setSelectedId(recording.id)}
                    className={cn(
                      "flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 transition-colors",
                      recording.id === selectedId
                        ? "bg-accent-blue/[0.06]"
                        : "hover:bg-slate-50/70",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-blue/[0.12] text-accent-blue">
                      <Play className="ml-0.5 h-3.5 w-3.5 fill-current" strokeWidth={0} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-brand-navy">
                        {recording.call?.lead?.name ?? recording.call?.phone ?? "Unknown"}
                      </span>
                      <span className="tabular block text-[11.5px] text-slate-500">
                        {recording.call?.startedAt
                          ? formatDateTime(recording.call.startedAt)
                          : "—"}
                        {recording.call?.aiAgent && ` · ${recording.call.aiAgent.name}`}
                      </span>
                    </span>

                    {outcome && <Badge tone={outcome.tone}>{outcome.label}</Badge>}

                    <span className="tabular shrink-0 text-[12.5px] text-slate-600">
                      {formatDuration(recording.durationSeconds)}
                    </span>

                    <span className="flex shrink-0 items-center gap-1.5">
                      {recording.call?.transcript && (
                        <Link
                          href="/transcripts"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="View transcript"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-accent-blue transition-colors hover:bg-slate-50"
                        >
                          <FileText className="h-3.5 w-3.5" strokeWidth={2.2} />
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void download(recording);
                        }}
                        aria-label="Download recording"
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-accent-blue transition-colors hover:bg-slate-50"
                      >
                        <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(recording);
                        }}
                        aria-label="Delete recording"
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-alert-red transition-colors hover:bg-alert-red/[0.07]"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <p className="tabular text-[12.5px] text-slate-500">
              {total === 0
                ? "No recordings"
                : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                    page * PAGE_SIZE,
                    total,
                  )} of ${formatNumber(total)} recordings`}
            </p>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        </Card>

        {selected && (
          <div className="xl:sticky xl:top-6">
            <Card className="p-5">
              <h2 className="truncate text-[16px] font-bold tracking-tight text-brand-navy">
                {selected.call?.lead?.name ?? selected.call?.phone ?? "Recording"}
              </h2>
              <p className="tabular mt-0.5 text-[12.5px] text-slate-500">
                {selected.call?.startedAt ? formatDateTime(selected.call.startedAt) : "—"}
              </p>

              <div className="mt-4 flex items-center gap-2.5">
                <button
                  type="button"
                  aria-label="Play recording"
                  disabled
                  title="No object storage is connected, so the audio cannot be played yet."
                  className="flex h-10 w-10 shrink-0 cursor-not-allowed items-center justify-center rounded-full bg-accent-blue text-white opacity-50"
                >
                  <Play className="ml-0.5 h-4 w-4 fill-current" strokeWidth={0} />
                </button>
                <Waveform bars={32} height={28} progress={0} className="min-w-0 flex-1" />
                <span className="tabular shrink-0 text-[11.5px] text-slate-400">
                  {formatDuration(selected.durationSeconds)}
                </span>
              </div>

              {/* Said plainly rather than left for the player to fail silently: a play
                  button that does nothing is a worse experience than one that explains. */}
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-amber/[0.08] p-2.5 text-[12px] leading-relaxed text-[#B4761A]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                No object storage is connected, so the audio cannot be played or
                downloaded yet. The recording&rsquo;s details are real; the file is not
                stored anywhere this app can reach.
              </p>

              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
                <Stat label="Duration" value={formatDuration(selected.durationSeconds)} />
                <Stat label="Size" value={formatBytes(selected.sizeBytes)} />
                <Stat label="Format" value={selected.mimeType} />
                <Stat
                  label="Expires"
                  value={selected.expiresAt ? formatDateTime(selected.expiresAt) : "Never"}
                />
              </dl>

              {selected.call?.campaign && (
                <p className="mt-3 text-[12.5px] text-slate-600">
                  Campaign:{" "}
                  <Link
                    href={`/campaigns/${selected.call.campaign.id}`}
                    className="font-semibold text-accent-blue hover:underline"
                  >
                    {selected.call.campaign.name}
                  </Link>
                </p>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
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

/** Binary units, because that is what a storage quota is measured in. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
