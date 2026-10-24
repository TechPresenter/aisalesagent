"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect, type FilterOption } from "@/components/ui/filter-select";
import { Pagination } from "@/components/ui/pagination";
import { ApiError, campaignsApi, leadsApi, type ApiLead } from "@/lib/api-client";
import { MAX_LEADS_PER_ADD } from "@/lib/campaign-setup";
import { LEAD_STATUS } from "@/lib/status";
import type { LeadStatus } from "@/lib/types";
import { useDebounced } from "@/lib/use-debounced";
import { cn, formatNumber } from "@/lib/utils";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: FilterOption[] = [
  { value: "", label: "Any status" },
  ...(Object.keys(LEAD_STATUS) as LeadStatus[]).map((status) => ({
    value: status,
    label: LEAD_STATUS[status].label,
  })),
];

/**
 * Adds leads to a campaign through `POST /campaigns/:id/leads`: either the ones ticked
 * here, or every lead the search and status filter match, which the API counts and adds
 * itself (up to 10,000 at a time).
 *
 * Leads marked do-not-call are shown but cannot be ticked, because the API would skip
 * them anyway. Leads already in the campaign are not marked here; the API skips those
 * too, and the summary afterwards says how many were skipped.
 */
export function CampaignLeadsPicker({
  open,
  campaignId,
  campaignName,
  onClose,
  onAdded,
}: {
  open: boolean;
  campaignId: string;
  campaignName: string;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{
    data: ApiLead[];
    total: number;
    totalPages: number;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search.trim());

  // A fresh picker every time it opens: a selection left over from last time would add
  // leads nobody looked at.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setStatus("");
    setPage(1);
    setSelected(new Set());
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    leadsApi
      .list({
        search: debouncedSearch || undefined,
        status: status ? [status as LeadStatus] : undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then(
        (response) => {
          if (cancelled) return;
          setResult(response);
          setLoadError(null);
        },
        (cause) => {
          if (cancelled) return;
          setLoadError(cause instanceof ApiError ? cause.message : "Could not load your leads.");
        },
      );
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch, status, page]);

  // Closing is ignored while a request is in flight, so its result is not lost. Read
  // through a ref so `close` keeps one identity for the Modal's focus handling.
  const workingRef = useRef(working);
  useEffect(() => {
    workingRef.current = working;
  }, [working]);
  const close = useCallback(() => {
    if (!workingRef.current) onClose();
  }, [onClose]);

  const matching = result?.total ?? 0;
  const tooMany = matching > MAX_LEADS_PER_ADD;
  const filtered = Boolean(debouncedSearch || status);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function add(work: () => Promise<{ added: number; skipped: number }>) {
    setWorking(true);
    setError(null);
    try {
      const { added, skipped } = await work();
      const lead = (n: number) => `${formatNumber(n)} ${n === 1 ? "lead" : "leads"}`;
      onAdded(
        `${lead(added)} added to ${campaignName}.` +
          (skipped > 0
            ? ` ${formatNumber(skipped)} skipped: already in the campaign or marked do-not-call.`
            : ""),
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not add the leads.");
    } finally {
      setWorking(false);
    }
  }

  const rows = result?.data ?? [];

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Add leads"
      description={`Choose the leads ${campaignName} should call.`}
      footer={
        <>
          <button
            type="button"
            onClick={() =>
              void add(() =>
                campaignsApi.addMatchingLeads(campaignId, {
                  search: debouncedSearch || undefined,
                  status: status ? [status as LeadStatus] : undefined,
                }),
              )
            }
            disabled={working || matching === 0 || tooMany}
            title={
              tooMany
                ? `At most ${formatNumber(MAX_LEADS_PER_ADD)} can be added at once. Narrow the search or status.`
                : undefined
            }
            className="h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Add all {formatNumber(matching)} {filtered ? "matching" : "leads"}
          </button>
          <button
            type="button"
            onClick={() => void add(() => campaignsApi.addLeads(campaignId, Array.from(selected)))}
            disabled={working || selected.size === 0}
            className="inline-flex h-10 items-center gap-2 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {working && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
            Add {formatNumber(selected.size)} selected
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-end">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search by name, phone or city..."
        />
        <FilterSelect
          label="Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>

      {tooMany && (
        <p className="mt-3 rounded-btn bg-warning-amber/[0.1] px-3 py-2 text-[12.5px] font-medium text-[#B4761A]">
          {formatNumber(matching)} leads match. At most {formatNumber(MAX_LEADS_PER_ADD)} can be
          added at once, so narrow the search or status, or tick leads one by one.
        </p>
      )}

      <div className="mt-3 overflow-hidden rounded-btn border border-slate-100">
        {loadError ? (
          <p className="px-4 py-10 text-center text-[13px] text-[#C93B3B]">{loadError}</p>
        ) : result === null ? (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
            Loading leads…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-slate-500">
            {filtered ? "No leads match this search." : "There are no leads in this workspace yet."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((lead) => {
              const checked = selected.has(lead.id);
              const statusDisplay = LEAD_STATUS[lead.status];
              return (
                <li key={lead.id}>
                  <label
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5",
                      lead.doNotCall
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-slate-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={lead.doNotCall}
                      onChange={() => toggle(lead.id)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[#19B969]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-brand-navy">
                        {lead.name}
                      </span>
                      <span className="tabular block truncate text-[11.5px] text-slate-500">
                        {lead.phone}
                        {lead.city ? ` · ${lead.city}` : ""}
                      </span>
                    </span>
                    {lead.doNotCall ? (
                      <Badge tone="red">Do not call</Badge>
                    ) : (
                      statusDisplay && (
                        <Badge tone={statusDisplay.tone}>{statusDisplay.label}</Badge>
                      )
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {result && result.totalPages > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="tabular text-[12px] text-slate-500">
            {formatNumber(result.total)} leads · {formatNumber(selected.size)} selected
          </p>
          <Pagination page={page} totalPages={result.totalPages} onChange={setPage} />
        </div>
      )}
    </Modal>
  );
}
