"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, PhoneOff, Play, RefreshCw } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DonutChart, DonutLegend, type DonutSlice } from "@/components/ui/donut-chart";
import { Waveform } from "@/components/calls/waveform";
import {
  ApiError,
  callsApi,
  campaignsApi,
  type ApiCall,
  type ApiCampaign,
  type CallingOverview,
  type DialerRunSummary,
} from "@/lib/api-client";
import { CALL_STATUS, CALL_OUTCOME, TONE_HEX } from "@/lib/status";
import { cn, formatDuration, formatNumber } from "@/lib/utils";

/**
 * How often the board refreshes while calls are in flight.
 *
 * Polling rather than a socket, for now: the API has no realtime channel yet, and a
 * five-second poll is honest about that. It also only polls while something is actually
 * happening — a console left open on an idle workspace should not hammer the API all
 * afternoon.
 */
const POLL_MS = 5000;

/** Feature List §5 — AI Calling console. */
export function AiCallingView() {
  const [overview, setOverview] = useState<CallingOverview | null>(null);
  const [active, setActive] = useState<ApiCall[]>([]);
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<DialerRunSummary[] | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  // Held in a ref so the polling effect can read it without re-subscribing every tick.
  const inFlightRef = useRef(0);

  const load = useCallback(async (opts: { sweep?: boolean } = {}) => {
    try {
      // Sweeping first, so the board shows settled calls rather than ones that finished
      // minutes ago and are still displayed as ringing.
      if (opts.sweep) await callsApi.syncActive().catch(() => undefined);

      const [next, live, campaignPage] = await Promise.all([
        callsApi.overview(),
        callsApi.active(),
        campaignsApi.list({ status: ["ACTIVE"], pageSize: 20 }),
      ]);

      setOverview(next);
      setActive(live);
      setCampaigns(campaignPage.data);
      inFlightRef.current = next.inFlight;
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      // Only while there is something to watch. An idle console stays quiet.
      if (inFlightRef.current > 0) void load({ sweep: true });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function run(key: string, work: () => Promise<unknown>, onDone?: (r: never) => string) {
    setBusy(key);
    try {
      const result = (await work()) as never;
      setNotice({ tone: "ok", text: onDone ? onDone(result) : "Done." });
      await load({ sweep: true });
    } catch (cause) {
      setNotice({
        tone: "bad",
        text: cause instanceof ApiError ? cause.message : "That did not work. Try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  const statusSlices: DonutSlice[] = (overview?.statusBreakdown ?? [])
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      label: CALL_STATUS[entry.status]?.label ?? entry.status,
      value: entry.count,
      color: TONE_HEX[CALL_STATUS[entry.status]?.tone ?? "gray"],
    }));

  const outcomeSlices: DonutSlice[] = (overview?.outcomeBreakdown ?? [])
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      label: CALL_OUTCOME[entry.outcome]?.label ?? entry.outcome,
      value: entry.count,
      color: TONE_HEX[CALL_OUTCOME[entry.outcome]?.tone ?? "gray"],
    }));

  if (loading) return <ConsoleSkeleton />;

  if (error && !overview) {
    return (
      <Card className="px-5 py-14 text-center">
        <p className="text-[13.5px] font-medium text-brand-navy">Could not load the console.</p>
        <p className="mt-1 text-[12.5px] text-slate-500">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex h-9 items-center rounded-btn border border-slate-200 px-4 text-[13px] font-semibold text-accent-blue transition-colors hover:bg-slate-50"
        >
          Try again
        </button>
      </Card>
    );
  }

  return (
    <>
      {/* The single most important thing on this screen: whether any of it is real. A
          console that looks live while dialling nothing is worse than no console. */}
      {overview?.usingSandbox && (
        <Card className="mb-5 flex items-start gap-3 border-warning-amber/40 bg-warning-amber/[0.07] p-4">
          <AlertTriangle
            className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#B4761A]"
            strokeWidth={2.1}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#B4761A]">
              No telephony provider is connected — nothing here is a real call.
            </p>
            <p className="mt-0.5 text-[12.5px] text-slate-600">
              Calls run against the sandbox, which records outcomes without dialling anyone.
              Connect a provider in{" "}
              <Link href="/settings" className="font-semibold text-accent-blue hover:underline">
                Settings → AI
              </Link>{" "}
              to place real calls.
            </p>
          </div>
        </Card>
      )}

      {!overview?.callingEnabled && (
        <Card className="mb-5 flex items-start gap-3 p-4">
          <PhoneOff className="mt-0.5 h-[18px] w-[18px] shrink-0 text-slate-400" strokeWidth={2} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-brand-navy">AI calling is switched off.</p>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              Campaigns will not dial until it is enabled in Settings → Call Settings.
            </p>
          </div>
        </Card>
      )}

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

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="In flight" value={overview?.inFlight ?? 0} tone="blue" live />
        <Metric label="Queued" value={overview?.queued ?? 0} tone="gray" />
        <Metric label="Placed today" value={overview?.today.placed ?? 0} tone="purple" />
        <Metric label="Connected today" value={overview?.today.connected ?? 0} tone="green" />
        <Metric label="Credits spent today" value={overview?.creditsSpentToday ?? 0} tone="amber" />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
              <CardTitle>Live Calls</CardTitle>
              <button
                type="button"
                onClick={() => void load({ sweep: true })}
                className="inline-flex h-9 items-center gap-2 rounded-btn border border-slate-200 px-3 text-[12.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
                Refresh
              </button>
            </div>

            {active.length === 0 ? (
              <p className="px-5 py-12 text-center text-[13px] text-slate-500">
                No calls in flight. Run a campaign below to start dialling.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {active.map((call) => {
                  const status = CALL_STATUS[call.status];
                  const elapsed = call.startedAt
                    ? Math.max(
                        0,
                        Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000),
                      )
                    : 0;

                  return (
                    <li key={call.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Badge tone={status?.tone ?? "gray"}>{status?.label ?? call.status}</Badge>
                      <span className="tabular min-w-0 flex-1 text-[13px] font-medium text-brand-navy">
                        {call.phone}
                      </span>
                      {call.status === "CONNECTED" && (
                        <Waveform bars={20} height={20} progress={1} animate className="shrink-0" />
                      )}
                      <span className="tabular shrink-0 text-[12.5px] text-slate-500">
                        {formatDuration(elapsed)}
                      </span>
                      <button
                        type="button"
                        disabled={busy === call.id}
                        onClick={() =>
                          void run(call.id, () => callsApi.hangUp(call.id), () => "Call ended.")
                        }
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-btn border border-alert-red/50 px-2.5 text-[12px] font-semibold text-alert-red transition-colors hover:bg-alert-red/[0.07] disabled:opacity-50"
                      >
                        {busy === call.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
                        ) : (
                          <PhoneOff className="h-3 w-3" strokeWidth={2.4} />
                        )}
                        End
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <CardTitle>Active Campaigns</CardTitle>
              <p className="mt-1 text-[12.5px] text-slate-500">
                Running a pass dials the next batch of due leads, respecting calling hours,
                retry delays and the credit balance.
              </p>
            </div>

            {campaigns.length === 0 ? (
              <p className="px-5 py-12 text-center text-[13px] text-slate-500">
                No active campaigns.{" "}
                <Link href="/campaigns" className="font-semibold text-accent-blue hover:underline">
                  Activate one
                </Link>{" "}
                to begin calling.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {campaigns.map((campaign) => (
                  <li key={campaign.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="block truncate text-[13px] font-semibold text-brand-navy hover:text-accent-blue hover:underline"
                      >
                        {campaign.name}
                      </Link>
                      <span className="tabular mt-0.5 block text-[11.5px] text-slate-500">
                        {formatNumber(campaign.stats.leads)} leads ·{" "}
                        {formatNumber(campaign.stats.calls)} calls
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy === campaign.id || !overview?.callingEnabled}
                      onClick={() =>
                        void run(
                          campaign.id,
                          () => callsApi.runDialer(campaign.id),
                          (summary: DialerRunSummary) =>
                            summary.placed > 0
                              ? `${campaign.name}: placed ${summary.placed} call${summary.placed === 1 ? "" : "s"}.`
                              : `${campaign.name}: nothing dialled — ${
                                  summary.blockedBy[0]?.reason
                                    ? summary.blockedBy[0].reason.toLowerCase().replace(/_/g, " ")
                                    : "no leads were due"
                                }.`,
                        )
                      }
                      title={
                        overview?.callingEnabled
                          ? undefined
                          : "Enable AI calling in Settings first"
                      }
                      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-btn bg-accent-blue px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#1B6CD8] disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      {busy === campaign.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                      ) : (
                        <Play className="h-3 w-3 fill-current" strokeWidth={0} />
                      )}
                      Run pass
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {lastRun && lastRun.length > 0 && (
              <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                <p className="text-[12px] font-semibold text-brand-navy">Last run</p>
                <ul className="mt-1 space-y-0.5">
                  {lastRun.map((summary) => (
                    <li key={summary.campaignId} className="text-[12px] text-slate-600">
                      {summary.campaignName}: placed {summary.placed}, blocked {summary.blocked}
                      {summary.blockedBy.length > 0 && (
                        <> — {summary.blockedBy[0].reason.toLowerCase().replace(/_/g, " ")}</>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {campaigns.length > 0 && (
              <div className="border-t border-slate-100 p-4">
                <button
                  type="button"
                  disabled={busy === "all" || !overview?.callingEnabled}
                  onClick={() =>
                    void run(
                      "all",
                      async () => {
                        const summaries = await callsApi.runDialerAll();
                        setLastRun(summaries);
                        return summaries;
                      },
                      (summaries: DialerRunSummary[]) => {
                        const placed = summaries.reduce((sum, s) => sum + s.placed, 0);
                        return placed > 0
                          ? `Placed ${placed} call${placed === 1 ? "" : "s"} across ${summaries.length} campaign${summaries.length === 1 ? "" : "s"}.`
                          : "Nothing was due to dial.";
                      },
                    )
                  }
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-slate-200 text-[13px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:text-slate-400"
                >
                  {busy === "all" ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                  ) : (
                    <Play className="h-3 w-3 fill-current" strokeWidth={0} />
                  )}
                  Run one pass over every active campaign
                </button>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <CardTitle>Today&rsquo;s Calls</CardTitle>
            {statusSlices.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <DonutChart
                  data={statusSlices}
                  centerValue={overview?.today.placed ?? 0}
                  centerLabel="Placed"
                />
                <DonutLegend data={statusSlices} />
              </div>
            ) : (
              <p className="mt-4 text-[12.5px] text-slate-500">No calls placed today.</p>
            )}
          </Card>

          <Card className="p-5">
            <CardTitle>Outcomes Today</CardTitle>
            {outcomeSlices.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <DonutChart
                  data={outcomeSlices}
                  centerValue={outcomeSlices.reduce((sum, s) => sum + s.value, 0)}
                  centerLabel="Outcomes"
                />
                <DonutLegend data={outcomeSlices} />
              </div>
            ) : (
              <p className="mt-4 text-[12.5px] text-slate-500">
                No call has produced an outcome yet today.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  tone,
  live,
}: {
  label: string;
  value: number;
  tone: "blue" | "green" | "purple" | "amber" | "gray";
  live?: boolean;
}) {
  return (
    <Card className="p-4">
      <span className="flex items-center gap-2">
        <span className="tabular text-[26px] font-bold leading-none tracking-tight text-brand-navy">
          {formatNumber(value)}
        </span>
        {live && value > 0 && (
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-green" />
          </span>
        )}
      </span>
      <p className="mt-1.5 text-[12px] text-slate-500">{label}</p>
      <span
        aria-hidden
        className="mt-2 block h-1 w-8 rounded-full"
        style={{ backgroundColor: TONE_HEX[tone] }}
      />
    </Card>
  );
}

function ConsoleSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Card key={i} className="p-4">
            <div className="h-6 w-14 animate-pulse rounded bg-slate-100" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-slate-100" />
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      </Card>
    </div>
  );
}
