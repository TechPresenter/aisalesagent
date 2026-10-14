"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ApiError, campaignsApi, type ApiCampaign, type LeadQuery } from "@/lib/api-client";
import { CAMPAIGN_STATUS } from "@/lib/campaign-display";
import { TooManyLeadsError, addLeadsToCampaign, collectLeadIds } from "@/lib/leads-repository";

const FIELD =
  "h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

/**
 * The most leads one "all matching" action may add. Above this the filter is almost
 * certainly broader than the user meant, and it would queue that many calls.
 */
export const MAX_BULK_LEADS = 10_000;

/** What the Leads table has selected: ticked rows, or everything the filters match. */
export type LeadSelection =
  { kind: "ids"; ids: string[] } | { kind: "filter"; query: LeadQuery; total: number };

type Phase =
  | { name: "pick" }
  | { name: "working"; progress: string }
  | { name: "done"; added: number; skipped: number; campaign: ApiCampaign };

/**
 * Attaches the selected leads to a campaign through `POST /campaigns/:id/leads`.
 *
 * Only campaigns that can still take leads are offered — draft, active or paused; the
 * API refuses a finished one. The answer is shown as the API gives it: how many were
 * added, and how many were skipped because they were already in the campaign or are
 * marked do-not-call, so a smaller number than selected is explained rather than
 * mysterious.
 */
export function AddToCampaignDialog({
  open,
  onClose,
  onAdded,
  selection,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once leads were added, so the table can clear its selection. */
  onAdded: () => void;
  /** Fixed for as long as the dialog is open, so clearing the table behind it changes nothing here. */
  selection: LeadSelection;
}) {
  const [campaigns, setCampaigns] = useState<ApiCampaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase({ name: "pick" });
    setError(null);
    setLoadError(null);
    setCampaigns(null);
    campaignsApi
      .list({ status: ["DRAFT", "ACTIVE", "PAUSED"], pageSize: 100 })
      .then((page) => {
        if (cancelled) return;
        setCampaigns(page.data);
        setCampaignId((current) =>
          page.data.some((campaign) => campaign.id === current)
            ? current
            : (page.data[0]?.id ?? ""),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(describe(cause, "Could not load your campaigns."));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const count = selection.kind === "ids" ? selection.ids.length : selection.total;
  const tooMany = selection.kind === "filter" && selection.total > MAX_BULK_LEADS;
  const campaign = campaigns?.find((candidate) => candidate.id === campaignId);
  const working = phase.name === "working";

  // Closing is ignored while a request is in flight, so the result is not lost. Read
  // through a ref so `close` keeps one identity: the Modal re-runs its focus handling
  // whenever its onClose changes, which would pull focus around on every progress update.
  const workingRef = useRef(working);
  useEffect(() => {
    workingRef.current = working;
  }, [working]);
  const close = useCallback(() => {
    if (!workingRef.current) onClose();
  }, [onClose]);

  async function submit() {
    if (!campaign || working || tooMany) return;
    setError(null);
    setPhase({ name: "working", progress: "Adding leads…" });
    try {
      const ids =
        selection.kind === "ids"
          ? selection.ids
          : await collectLeadIds(selection.query, MAX_BULK_LEADS, (collected, total) =>
              setPhase({
                name: "working",
                progress: `Collecting leads: ${collected.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}…`,
              }),
            );
      setPhase({ name: "working", progress: "Adding leads…" });
      const result = await addLeadsToCampaign(campaign.id, ids);
      setPhase({ name: "done", ...result, campaign });
      onAdded();
    } catch (cause) {
      setPhase({ name: "pick" });
      setError(
        describe(cause, "Could not add the leads.") +
          (count > 1_000
            ? " Leads already added stay in the campaign; trying again skips them."
            : ""),
      );
    }
  }

  const label = `${count.toLocaleString("en-IN")} ${count === 1 ? "lead" : "leads"}`;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add to campaign"
      description={
        selection.kind === "filter"
          ? `All ${label} matching the current filters.`
          : `${label} selected.`
      }
      footer={
        phase.name === "done" ? (
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D]"
          >
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={working}
              className="h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!campaign || working || tooMany}
              className="inline-flex h-10 items-center gap-2 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
            >
              {working && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
              Add {label}
            </button>
          </>
        )
      }
    >
      {phase.name === "done" ? (
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" strokeWidth={2.2} />
          <div className="text-[13.5px] leading-relaxed text-brand-navy">
            <p>
              Added {phase.added.toLocaleString("en-IN")} {phase.added === 1 ? "lead" : "leads"} to{" "}
              <span className="font-semibold">{phase.campaign.name}</span>.
            </p>
            {phase.skipped > 0 && (
              <p className="mt-1 text-[13px] text-slate-600">
                {phase.skipped.toLocaleString("en-IN")} skipped: already in this campaign or marked
                do-not-call.
              </p>
            )}
            <Link
              href={`/campaigns/${phase.campaign.id}`}
              className="mt-2 inline-block text-[13px] font-semibold text-accent-blue hover:underline"
            >
              Open campaign
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {error && (
            <p
              role="alert"
              className="rounded-btn bg-alert-red/[0.09] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
            >
              {error}
            </p>
          )}

          {tooMany && (
            <p className="rounded-btn bg-warning-amber/[0.1] px-3 py-2 text-[12.5px] font-medium text-[#8A5A12]">
              {new TooManyLeadsError(count, MAX_BULK_LEADS).message}
            </p>
          )}

          {loadError ? (
            <p className="text-[13px] text-[#C93B3B]">{loadError}</p>
          ) : campaigns === null ? (
            <p className="flex items-center gap-2 text-[13px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
              Loading campaigns…
            </p>
          ) : campaigns.length === 0 ? (
            <p className="text-[13px] text-slate-600">
              There is no draft, active or paused campaign to add leads to.{" "}
              <Link href="/campaigns" className="font-semibold text-accent-blue hover:underline">
                Create a campaign
              </Link>{" "}
              first.
            </p>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Campaign</span>
              <select
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
                disabled={working}
                className={FIELD}
              >
                {campaigns.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {CAMPAIGN_STATUS[option.status].label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {working && (
            <p className="text-[12.5px] text-slate-500" aria-live="polite">
              {phase.progress}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function describe(cause: unknown, fallback: string): string {
  if (cause instanceof TooManyLeadsError) return cause.message;
  if (cause instanceof ApiError) {
    return cause.status === 403
      ? "Your role does not allow adding leads to campaigns. Ask a workspace admin or manager."
      : cause.message || fallback;
  }
  return "We could not reach the server. Check your connection and try again.";
}
