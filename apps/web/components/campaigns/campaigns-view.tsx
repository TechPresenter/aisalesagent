"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { DonutChart, DonutLegend, type DonutSlice } from "@/components/ui/donut-chart";
import { CampaignSeriesChart } from "@/components/campaigns/campaign-series-chart";
import {
  ApiError,
  campaignsApi,
  type ApiCampaign,
  type CampaignOverview,
  type CampaignStatus,
} from "@/lib/api-client";
import { CAMPAIGN_STATUS, CAMPAIGN_TYPE, availableActions } from "@/lib/campaign-display";
import { TONE_HEX } from "@/lib/status";
import { cn, formatDate, formatNumber } from "@/lib/utils";

const PAGE_SIZE = 8;

/** The tab strip, mapped to the statuses each tab means. */
const TABS: { label: string; statuses?: CampaignStatus[] }[] = [
  { label: "All Campaigns" },
  { label: "Active", statuses: ["ACTIVE"] },
  { label: "Paused", statuses: ["PAUSED"] },
  { label: "Completed", statuses: ["COMPLETED"] },
  { label: "Drafts", statuses: ["DRAFT"] },
];

/**
 * Feature List §4 — Campaigns, against `GET /campaigns`.
 *
 * Every number on this screen is counted in the database: the table's rows and totals
 * come from the list endpoint with server-side search, filtering and paging, and the
 * chart and donut come from `/campaigns/overview`. Nothing is derived from the visible
 * page, because a page of eight cannot tell you how many campaigns exist.
 *
 * Lifecycle buttons call the API and refetch. The server decides whether a transition is
 * legal and refuses with a sentence; this component shows that sentence rather than
 * keeping its own copy of the rules.
 */
export function CampaignsView({ refreshKey = 0 }: { refreshKey?: number }) {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<{
    data: ApiCampaign[];
    total: number;
    totalPages: number;
    page: number;
  } | null>(null);
  const [overview, setOverview] = useState<CampaignOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, stats] = await Promise.all([
        campaignsApi.list({
          search: search.trim() || undefined,
          status: TABS[tab].statuses,
          page,
          pageSize: PAGE_SIZE,
        }),
        campaignsApi.overview(),
      ]);
      setResult(list);
      setOverview(stats);
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
  }, [search, tab, page]);

  // `refreshKey` is bumped by the screen after it creates a campaign.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Notices clear themselves; a toast that stays until the next click reads as an error
  // state long after the thing it described succeeded.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function run(id: string, work: () => Promise<unknown>, success: string) {
    setBusyId(id);
    try {
      await work();
      setNotice({ tone: "ok", text: success });
      await load();
    } catch (cause) {
      // The server's refusal is the useful message — "Before activating, assign an AI
      // agent…" tells someone what to do; "Something went wrong" does not.
      setNotice({
        tone: "bad",
        text: cause instanceof ApiError ? cause.message : "That did not work. Try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  const rows = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;

  const statusSlices: DonutSlice[] = (overview?.statusBreakdown ?? [])
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      label: CAMPAIGN_STATUS[entry.status].label,
      value: entry.count,
      color: TONE_HEX[CAMPAIGN_STATUS[entry.status].tone],
    }));

  return (
    <>
      {notice && (
        <div
          role="status"
          className={cn(
            "mb-4 rounded-btn px-4 py-2.5 text-[13px] font-medium",
            notice.tone === "ok"
              ? "bg-brand-green/[0.1] text-deep-green"
              : "bg-alert-red/[0.09] text-[#C93B3B]",
          )}
        >
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex min-w-0 flex-col overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="Search campaigns by name or description..."
                className="min-w-[240px] flex-1"
              />
            </div>

            <div
              role="tablist"
              aria-label="Campaign status"
              className="scrollbar-thin mt-3.5 flex gap-1 overflow-x-auto"
            >
              {TABS.map((entry, index) => (
                <button
                  key={entry.label}
                  role="tab"
                  aria-selected={tab === index}
                  onClick={() => {
                    setTab(index);
                    setPage(1);
                  }}
                  className={cn(
                    "shrink-0 rounded-btn px-3.5 py-2 text-[13px] font-semibold transition-colors",
                    tab === index
                      ? "bg-accent-blue text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-brand-navy",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="scrollbar-thin w-full overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50/80">
                  <Th className="pl-4">Campaign</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>Leads</Th>
                  <Th>Calls</Th>
                  <Th>Interested</Th>
                  <Th>Conversion</Th>
                  <Th className="pr-4">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((campaign) => {
                  const status = CAMPAIGN_STATUS[campaign.status];
                  const type = CAMPAIGN_TYPE[campaign.type];
                  const busy = busyId === campaign.id;

                  return (
                    <tr key={campaign.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="py-3 pl-4 pr-2">
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          className="block text-[13px] font-semibold text-brand-navy hover:text-accent-blue hover:underline"
                        >
                          {campaign.name}
                        </Link>
                        <span className="mt-0.5 block text-[11.5px] text-slate-500">
                          Created {formatDate(campaign.createdAt)}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <Badge tone={type.tone}>{type.label}</Badge>
                      </td>
                      <td className="px-2 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="tabular px-2 py-3 text-[12.5px] text-brand-navy">
                        {formatNumber(campaign.stats.leads)}
                      </td>
                      <td className="tabular px-2 py-3 text-[12.5px] text-brand-navy">
                        {formatNumber(campaign.stats.calls)}
                      </td>
                      <td className="tabular px-2 py-3 text-[12.5px] text-brand-navy">
                        {formatNumber(campaign.stats.interested)}
                      </td>
                      <td className="tabular px-2 py-3 text-[12.5px] text-brand-navy">
                        {campaign.stats.conversionRate}%
                      </td>
                      <td className="py-3 pl-2 pr-4">
                        <span className="flex items-center gap-1.5">
                          {busy ? (
                            <Loader2
                              className="h-4 w-4 animate-spin text-slate-400"
                              strokeWidth={2.2}
                            />
                          ) : (
                            <>
                              {availableActions(campaign.status).map((entry) => (
                                <button
                                  key={entry.action}
                                  type="button"
                                  onClick={() =>
                                    void run(
                                      campaign.id,
                                      () => campaignsApi.transition(campaign.id, entry.action),
                                      `${campaign.name} — ${entry.label.toLowerCase()}d.`,
                                    )
                                  }
                                  className={cn(
                                    "rounded-md px-2 py-1 text-[12px] font-semibold transition-colors",
                                    entry.tone === "primary"
                                      ? "bg-accent-blue text-white hover:bg-[#1B6CD8]"
                                      : "border border-slate-200 text-brand-navy hover:bg-slate-50",
                                  )}
                                >
                                  {entry.label}
                                </button>
                              ))}
                              <IconAction
                                label={`Duplicate ${campaign.name}`}
                                icon={Copy}
                                onClick={() =>
                                  void run(
                                    campaign.id,
                                    () => campaignsApi.duplicate(campaign.id),
                                    `${campaign.name} duplicated as a draft.`,
                                  )
                                }
                              />
                              <IconAction
                                label={`Delete ${campaign.name}`}
                                icon={Trash2}
                                danger
                                onClick={() => {
                                  // A campaign with call history is refused server-side;
                                  // this only guards the accidental click.
                                  if (
                                    !window.confirm(
                                      `Delete "${campaign.name}"? This cannot be undone.`,
                                    )
                                  ) {
                                    return;
                                  }
                                  void run(
                                    campaign.id,
                                    () => campaignsApi.remove(campaign.id),
                                    `${campaign.name} deleted.`,
                                  );
                                }}
                              />
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {loading && rows.length === 0 && (
              <div className="divide-y divide-slate-100" aria-busy="true">
                <span className="sr-only">Loading campaigns</span>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
                      <div className="h-2.5 w-28 animate-pulse rounded bg-slate-100" />
                    </div>
                    <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
                    <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
                  </div>
                ))}
              </div>
            )}

            {error && rows.length === 0 && (
              <div className="px-5 py-14 text-center">
                <p className="text-[13.5px] font-medium text-brand-navy">
                  Could not load campaigns.
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
                  {search || TABS[tab].statuses
                    ? "No campaigns match this view."
                    : "No campaigns yet."}
                </p>
                <p className="mt-1 text-[12.5px] text-slate-500">
                  A campaign groups the leads an AI agent will call, and the rules it calls
                  them under.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <p className="tabular text-[12.5px] text-slate-500">
              {total === 0
                ? "No campaigns"
                : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                    page * PAGE_SIZE,
                    total,
                  )} of ${formatNumber(total)} campaigns`}
            </p>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <CardTitle>Campaigns by Status</CardTitle>
            {statusSlices.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <DonutChart
                  data={statusSlices}
                  centerValue={overview?.totalCampaigns ?? 0}
                  centerLabel="Campaigns"
                />
                <DonutLegend data={statusSlices} />
              </div>
            ) : (
              <p className="mt-4 text-[12.5px] text-slate-500">
                Nothing to chart yet — create a campaign to see the breakdown.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <CardTitle>Last 30 Days</CardTitle>
            <p className="mt-1 text-[12px] text-slate-500">
              Calls placed by campaigns, and what they produced.
            </p>
            <div className="mt-3">
              <CampaignSeriesChart series={overview?.series ?? []} />
            </div>
          </Card>
        </div>
      </div>
    </>
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

function IconAction({
  label,
  icon: Icon,
  onClick,
  danger,
}: {
  label: string;
  icon: typeof Copy;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 transition-colors",
        danger
          ? "text-alert-red hover:bg-alert-red/[0.07]"
          : "text-slate-500 hover:bg-slate-50 hover:text-brand-navy",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
    </button>
  );
}
