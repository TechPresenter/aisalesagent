"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, FileText, Mic, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-select";
import { Pagination } from "@/components/ui/pagination";
import { AgentAvatar } from "@/components/calls/call-status-badge";
import { CallDetailPanel } from "@/components/calls/call-detail-panel";
import {
  ApiError,
  callsApi,
  campaignsApi,
  type ApiCallDetailed,
  type ApiCampaign,
  type CallOutcome,
  type CallStatus,
} from "@/lib/api-client";
import { CALL_OUTCOME, CALL_STATUS } from "@/lib/status";
import { cn, formatDuration, formatNumber, splitDateTime } from "@/lib/utils";

const ALL = "all";
const PAGE_SIZE = 15;

/**
 * Feature List §6 — Call History, against `GET /calls`.
 *
 * Filtering, paging and the KPI strip are all server-side, and the strip takes the same
 * date range as the table so the numbers above cannot contradict the rows below — the
 * failure mode of a filtered table under an all-time summary.
 */
export function CallHistoryView() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [outcome, setOutcome] = useState(ALL);
  const [campaignId, setCampaignId] = useState(ALL);
  const [duration, setDuration] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [rows, setRows] = useState<ApiCallDetailed[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callsApi.list({
        search: search.trim() || undefined,
        status: status === ALL ? undefined : [status as CallStatus],
        outcome: outcome === ALL ? undefined : [outcome as CallOutcome],
        campaignId: campaignId === ALL ? undefined : campaignId,
        duration: duration === ALL ? undefined : (duration as "short" | "medium" | "long"),
        page,
        pageSize: PAGE_SIZE,
      });

      setRows(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setSelectedId((current) =>
        current && result.data.some((c) => c.id === current)
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
  }, [search, status, outcome, campaignId, duration, page]);

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

  // The Filters button shows and hides the filter row; the filters keep applying either way.
  const [showFilters, setShowFilters] = useState(true);

  const clearAll = () => {
    setSearch("");
    setStatus(ALL);
    setOutcome(ALL);
    setCampaignId(ALL);
    setDuration(ALL);
    setPage(1);
  };

  const filtersActive =
    search !== "" || [status, outcome, campaignId, duration].some((v) => v !== ALL);

  const selected = rows.find((call) => call.id === selectedId);

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_364px]">
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              value={search}
              onChange={withReset(setSearch)}
              placeholder="Search by number, company or contact..."
              className="min-w-[240px] flex-1"
            />
            <button
              type="button"
              onClick={() => setShowFilters((shown) => !shown)}
              aria-expanded={showFilters}
              aria-controls="call-history-filters"
              className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-btn border border-slate-200 px-3.5 text-[13px] font-medium text-brand-navy transition-colors hover:bg-slate-50 ${showFilters ? "bg-slate-50" : ""}`}
            >
              <SlidersHorizontal className="h-4 w-4 text-slate-400" strokeWidth={2} />
              {showFilters ? "Hide Filters" : "Filters"}
            </button>
          </div>

          <div
            id="call-history-filters"
            className={showFilters ? "mt-4 flex flex-wrap items-end gap-3" : "hidden"}
          >
            <FilterSelect
              label="Status"
              value={status}
              onChange={withReset(setStatus)}
              className="w-[140px] flex-1"
              options={[
                { value: ALL, label: "All Status" },
                ...Object.entries(CALL_STATUS).map(([value, { label }]) => ({ value, label })),
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
            <FilterSelect
              label="Duration"
              value={duration}
              onChange={withReset(setDuration)}
              className="w-[140px] flex-1"
              options={[
                { value: ALL, label: "Any Duration" },
                { value: "short", label: "Under 1 min" },
                { value: "medium", label: "1 – 3 min" },
                { value: "long", label: "Over 3 min" },
              ]}
            />
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 text-[13px] font-semibold text-accent-blue transition-colors hover:underline"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              Clear All
            </button>
          </div>
        </div>

        <div className="scrollbar-thin w-full overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50/80">
                <Th className="pl-4">
                  <span className="inline-flex items-center gap-1">
                    Date &amp; Time
                    <ArrowDown className="h-3 w-3" strokeWidth={2.4} />
                  </span>
                </Th>
                <Th>Company / Contact</Th>
                <Th>Phone</Th>
                <Th>Agent</Th>
                <Th>Duration</Th>
                <Th>Status</Th>
                <Th>Outcome</Th>
                <Th className="pr-4">Media</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((call) => {
                const when = call.startedAt ? splitDateTime(call.startedAt) : null;
                const statusInfo = CALL_STATUS[call.status];
                const outcomeInfo = call.outcome ? CALL_OUTCOME[call.outcome] : null;

                return (
                  <tr
                    key={call.id}
                    onClick={() => setSelectedId(call.id)}
                    className={cn(
                      "cursor-pointer border-t border-slate-100 transition-colors",
                      call.id === selectedId ? "bg-accent-blue/[0.06]" : "hover:bg-slate-50/70",
                    )}
                  >
                    <td className="whitespace-nowrap py-3 pl-4 pr-2">
                      {when ? (
                        <>
                          <span className="tabular block text-[12.5px] text-brand-navy">
                            {when.date}
                          </span>
                          <span className="tabular block text-[11.5px] text-slate-400">
                            {when.time}
                          </span>
                        </>
                      ) : (
                        <span className="text-[12.5px] text-slate-400">Queued</span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      {call.lead ? (
                        <Link
                          href={`/leads/${call.lead.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block whitespace-nowrap text-[12.5px] font-semibold text-brand-navy hover:text-accent-blue hover:underline"
                        >
                          {call.lead.name}
                        </Link>
                      ) : (
                        <span className="text-[12.5px] text-slate-400">—</span>
                      )}
                      <span className="block text-[11.5px] text-slate-500">
                        {call.lead?.contactPerson ?? call.lead?.city ?? ""}
                      </span>
                    </td>
                    <td className="tabular whitespace-nowrap px-2 py-3 text-[12.5px] text-brand-navy">
                      {call.phone}
                    </td>
                    <td className="px-2 py-3">
                      {call.aiAgent ? (
                        <span className="flex items-center gap-2">
                          <AgentAvatar initial={call.aiAgent.name.charAt(0)} tone="blue" />
                          <span className="whitespace-nowrap text-[12.5px] text-brand-navy">
                            {call.aiAgent.name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="tabular px-2 py-3 text-[12.5px] text-brand-navy">
                      {call.durationSeconds ? formatDuration(call.durationSeconds) : "—"}
                    </td>
                    <td className="px-2 py-3">
                      <Badge tone={statusInfo?.tone ?? "gray"}>
                        {statusInfo?.label ?? call.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-3">
                      {outcomeInfo ? (
                        <Badge tone={outcomeInfo.tone}>{outcomeInfo.label}</Badge>
                      ) : (
                        <span className="text-[12.5px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pl-2 pr-4">
                      {/* Icons reflect what actually exists, not what a call of this kind
                          usually has. A greyed-out play button on a call with no recording
                          is the honest rendering. */}
                      <span className="flex items-center gap-1.5">
                        <MediaDot present={Boolean(call.recording)} icon={Mic} label="Recording" />
                        <MediaDot
                          present={Boolean(call.transcript)}
                          icon={FileText}
                          label="Transcript"
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {loading && rows.length === 0 && (
            <div className="divide-y divide-slate-100" aria-busy="true">
              <span className="sr-only">Loading calls</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="h-8 w-20 animate-pulse rounded bg-slate-100" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
                    <div className="h-2.5 w-24 animate-pulse rounded bg-slate-100" />
                  </div>
                  <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          )}

          {error && rows.length === 0 && (
            <div className="px-5 py-14 text-center">
              <p className="text-[13.5px] font-medium text-brand-navy">Could not load calls.</p>
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
                {filtersActive ? "No calls match these filters." : "No calls yet."}
              </p>
              {filtersActive ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-2 text-[13px] font-semibold text-accent-blue hover:underline"
                >
                  Clear all filters
                </button>
              ) : (
                <Link
                  href="/ai-calling"
                  className="mt-3 inline-flex h-9 items-center rounded-btn bg-accent-blue px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
                >
                  Open the calling console
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="tabular text-[12.5px] text-slate-500">
            {total === 0
              ? "No calls"
              : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                  page * PAGE_SIZE,
                  total,
                )} of ${formatNumber(total)} calls`}
          </p>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </Card>

      {selected && (
        <div className="xl:sticky xl:top-6">
          <CallDetailPanel key={selected.id} call={selected} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
        className,
      )}
    >
      {children}
    </th>
  );
}

function MediaDot({
  present,
  icon: Icon,
  label,
}: {
  present: boolean;
  icon: typeof Mic;
  label: string;
}) {
  return (
    <span
      title={present ? label : `No ${label.toLowerCase()}`}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md",
        present ? "bg-accent-blue/[0.12] text-accent-blue" : "bg-slate-100 text-slate-300",
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.2} />
      <span className="sr-only">{present ? label : `No ${label.toLowerCase()}`}</span>
    </span>
  );
}
