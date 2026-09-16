"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MoreVertical, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect, type FilterOption } from "@/components/ui/filter-select";
import { Pagination } from "@/components/ui/pagination";
import { ScorePill } from "@/components/ui/score-pill";
import { LeadSourceBadge, LeadStatusBadge } from "@/components/ui/status-badge";
import { LeadDetailsPanel } from "@/components/leads/lead-details-panel";
import { LEAD_SOURCE, LEAD_STATUS } from "@/lib/status";
import { leadCities } from "@/lib/mock-leads";
import {
  isApiReachable,
  leadsApi,
  usersApi,
  type ApiLead,
  type WorkspaceMember,
} from "@/lib/api-client";
import { fetchLeads, type LeadPage } from "@/lib/leads-repository";
import { cn, splitDateTime } from "@/lib/utils";
import type { LeadDetail, LeadSource, LeadStatus } from "@/lib/types";

const PAGE_SIZE = 10;

const ALL = "all";

const DATE_WINDOWS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * The Leads workspace: search, six filters, the table, pagination and the details panel.
 *
 * Filtering, sorting and paging all happen server-side against `GET /leads`. That is not
 * a detail: a table that fetches everything and slices it in the browser works fine on
 * sixty seeded rows and falls over on sixty thousand real ones, and the failure arrives
 * in production rather than in review.
 *
 * `fetchLeads` falls back to seed data when the API is unreachable and reports which
 * source it used, so the banner below can say so rather than presenting seed rows as if
 * they were live.
 */
export function LeadsBrowser({ initialSearch = "" }: { initialSearch?: string }) {
  // Seeded from `?search=` so the header's search box can land here with a query.
  const [search, setSearch] = useState(initialSearch);
  const [source, setSource] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [city, setCity] = useState(ALL);
  const [scoreBand, setScoreBand] = useState(ALL);
  const [agent, setAgent] = useState(ALL);
  const [dateWindow, setDateWindow] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<LeadPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Filter options from the workspace's own data. The seed lists only stand in while the
  // API is down, when the table shows seed rows anyway. Cities are read from the newest
  // 200 leads, since there is no distinct-cities endpoint yet.
  const [cityOptions, setCityOptions] = useState<string[]>(leadCities);
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await isApiReachable())) return;
      const [members, sample] = await Promise.all([
        usersApi.list({ status: ["ACTIVE"] }).catch((): WorkspaceMember[] => []),
        leadsApi.list({ pageSize: 200 }).then(
          (result) => result.data,
          (): ApiLead[] => [],
        ),
      ]);
      if (cancelled) return;
      setOwners(members.map(({ id, name }) => ({ id, name })));
      setCityOptions(
        Array.from(
          new Set(sample.map((lead) => lead.city).filter((c): c is string => Boolean(c))),
        ).sort(),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // `cancelled` rather than an AbortController because the fetch itself is cheap and
    // the thing that actually matters is not letting a slow response for page 1 overwrite
    // a fast one for page 2. Ignoring the stale result is the whole fix.
    let cancelled = false;

    setLoading(true);
    fetchLeads({
      search: search.trim() || undefined,
      status: status === ALL ? undefined : [status as LeadStatus],
      source: source === ALL ? undefined : [source as LeadSource],
      city: city === ALL ? undefined : city,
      scoreBand: scoreBand === ALL ? undefined : (scoreBand as "high" | "medium" | "low"),
      createdWithinDays: dateWindow === ALL ? undefined : DATE_WINDOWS[dateWindow],
      ownerId: agent === ALL ? undefined : agent,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        setLoadError(false);
        // Select the first row of a fresh result rather than holding a selection that is
        // no longer on screen — a details panel showing a lead the table does not list
        // reads as a bug.
        setSelectedId((current) =>
          current && next.leads.some((lead) => lead.id === current)
            ? current
            : (next.leads[0]?.id ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search, source, status, city, scoreBand, agent, dateWindow, page]);

  const rows = result?.leads ?? [];
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;
  const safePage = result?.page ?? page;

  const selected = selectedId ? rows.find((lead) => lead.id === selectedId) : undefined;

  const filtersActive =
    search !== "" ||
    [source, status, city, scoreBand, agent, dateWindow].some((value) => value !== ALL);

  const resetFilters = () => {
    setSearch("");
    setSource(ALL);
    setStatus(ALL);
    setCity(ALL);
    setScoreBand(ALL);
    setAgent(ALL);
    setDateWindow(ALL);
    setPage(1);
  };

  /** Any filter change resets to page 1 — page 7 of a 2-page result is an empty table. */
  const withReset = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const allOnPageChecked = rows.length > 0 && rows.every((lead) => checked.has(lead.id));

  const toggleAll = () => {
    const next = new Set(checked);
    if (allOnPageChecked) rows.forEach((lead) => next.delete(lead.id));
    else rows.forEach((lead) => next.add(lead.id));
    setChecked(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_344px]">
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <SearchInput
            value={search}
            onChange={withReset(setSearch)}
            placeholder="Search by name, clinic, or phone number..."
          />

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Source"
              value={source}
              onChange={withReset(setSource)}
              className="w-[140px] flex-1"
              options={[
                { value: ALL, label: "All Sources" },
                ...Object.entries(LEAD_SOURCE).map(([value, { label }]) => ({ value, label })),
              ]}
            />
            <FilterSelect
              label="Status"
              value={status}
              onChange={withReset(setStatus)}
              className="w-[140px] flex-1"
              options={[
                { value: ALL, label: "All Status" },
                ...Object.entries(LEAD_STATUS).map(([value, { label }]) => ({ value, label })),
              ]}
            />
            <FilterSelect
              label="City"
              value={city}
              onChange={withReset(setCity)}
              className="w-[130px] flex-1"
              options={[
                { value: ALL, label: "All Cities" },
                ...cityOptions.map((name): FilterOption => ({ value: name, label: name })),
              ]}
            />
            <FilterSelect
              label="Lead Score"
              value={scoreBand}
              onChange={withReset(setScoreBand)}
              className="w-[140px] flex-1"
              options={[
                { value: ALL, label: "All Scores" },
                { value: "high", label: "High (75-100)" },
                { value: "medium", label: "Medium (50-74)" },
                { value: "low", label: "Low (0-49)" },
              ]}
            />
            <FilterSelect
              label="Assigned Agent"
              value={agent}
              onChange={withReset(setAgent)}
              className="w-[150px] flex-1"
              options={[
                { value: ALL, label: "All Agents" },
                // The API filters by owner id; "unassigned" is its word for no owner.
                ...(owners.length > 0 ? [{ value: "unassigned", label: "Unassigned" }] : []),
                ...owners.map(({ id, name }): FilterOption => ({ value: id, label: name })),
              ]}
            />
            <FilterSelect
              label="Date Added"
              value={dateWindow}
              onChange={withReset(setDateWindow)}
              className="w-[130px] flex-1"
              options={[
                { value: ALL, label: "Any Date" },
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "90d", label: "Last 90 days" },
              ]}
            />

            <button
              type="button"
              onClick={resetFilters}
              disabled={!filtersActive}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-btn border border-slate-200 px-3.5 text-[13px] font-medium text-brand-navy transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
              Clear Filters
            </button>
          </div>
        </div>

        <div className="scrollbar-thin relative w-full overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50/80">
                <Th className="w-9 pl-4">
                  <input
                    type="checkbox"
                    checked={allOnPageChecked}
                    onChange={toggleAll}
                    aria-label="Select all leads on this page"
                    className="h-4 w-4 cursor-pointer rounded border-slate-300 text-accent-blue accent-[#237DF5]"
                  />
                </Th>
                <Th className="min-w-[158px]">Lead / Clinic</Th>
                <Th>Phone</Th>
                <Th>City</Th>
                <Th>Source</Th>
                <Th>Lead Score</Th>
                <Th>Status</Th>
                <Th>AI Agent</Th>
                <Th className="px-2">Last Contact</Th>
                <Th className="px-2">Next Follow-up</Th>
                <Th className="pr-4 text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  selected={lead.id === selectedId}
                  checked={checked.has(lead.id)}
                  onCheck={() => toggleOne(lead.id)}
                  onSelect={() => setSelectedId(lead.id)}
                />
              ))}
            </tbody>
          </table>

          {/* Three distinct states, because they need three different responses from the
              reader: wait, fix your filters, or retry. Collapsing them into one "no data"
              message tells someone staring at a failed request to go and change a filter. */}
          {loading && rows.length === 0 && (
            <div className="divide-y divide-slate-100" aria-busy="true" aria-live="polite">
              <span className="sr-only">Loading leads</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-slate-100" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
                    <div className="h-2.5 w-24 animate-pulse rounded bg-slate-100" />
                  </div>
                  <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
                  <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          )}

          {loadError && rows.length === 0 && (
            <div className="px-5 py-14 text-center">
              <p className="text-[13.5px] font-medium text-brand-navy">
                Could not load leads.
              </p>
              <p className="mt-1 text-[12.5px] text-slate-500">
                The server did not respond. Check that the API is running.
              </p>
              <button
                type="button"
                onClick={() => setPage((current) => current)}
                className="mt-3 inline-flex h-9 items-center rounded-btn border border-slate-200 px-4 text-[13px] font-semibold text-accent-blue transition-colors hover:bg-slate-50"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !loadError && rows.length === 0 && (
            <div className="px-5 py-14 text-center">
              <p className="text-[13.5px] font-medium text-brand-navy">
                {filtersActive ? "No leads match these filters." : "No leads yet."}
              </p>
              {filtersActive ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-2 text-[13px] font-semibold text-accent-blue hover:underline"
                >
                  Clear all filters
                </button>
              ) : (
                <Link
                  href="/leads/import"
                  className="mt-3 inline-flex h-9 items-center rounded-btn bg-accent-blue px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
                >
                  Import your first leads
                </Link>
              )}
            </div>
          )}
        </div>

        {result?.source === "seed" && (
          <p className="border-t border-amber-200 bg-warning-amber/[0.08] px-4 py-2 text-[12px] font-medium text-[#B4761A]">
            Showing sample data — the API is not reachable, so these rows are not from your
            workspace.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="tabular text-[12.5px] text-slate-500">
            {total === 0
              ? "No leads to show"
              : `Showing ${(safePage - 1) * PAGE_SIZE + 1} to ${Math.min(
                  safePage * PAGE_SIZE,
                  total,
                )} of ${total.toLocaleString("en-IN")} leads`}
          </p>
          <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
        </div>
      </Card>

      {selected && (
        <div className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)]">
          <LeadDetailsPanel
            key={selected.id}
            lead={selected}
            live={result?.source === "api"}
            onClose={() => setSelectedId(null)}
          />
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
        "whitespace-nowrap px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
        className,
      )}
    >
      {children}
    </th>
  );
}

function LeadRow({
  lead,
  selected,
  checked,
  onCheck,
  onSelect,
}: {
  lead: LeadDetail;
  selected: boolean;
  checked: boolean;
  onCheck: () => void;
  onSelect: () => void;
}) {
  const lastContact = lead.lastContactedAt ? splitDateTime(lead.lastContactedAt) : null;
  const followUp = lead.nextFollowUp ? splitDateTime(lead.nextFollowUp.dueAt) : null;

  return (
    <tr
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-t border-slate-100 transition-colors",
        selected ? "bg-accent-blue/[0.06]" : "hover:bg-slate-50/70",
      )}
    >
      <td className="py-3 pl-4 pr-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onCheck}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${lead.name}`}
          className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#237DF5]"
        />
      </td>

      <td className="min-w-[158px] px-2.5 py-3">
        <Link
          href={`/leads/${lead.id}`}
          onClick={(event) => event.stopPropagation()}
          className="block truncate whitespace-nowrap text-[13px] font-semibold text-brand-navy hover:text-brand-green"
        >
          {lead.name}
        </Link>
        <span className="block truncate whitespace-nowrap text-[12px] text-slate-500">
          {lead.contactPerson}
        </span>
      </td>

      <td className="tabular whitespace-nowrap px-2.5 py-3 text-[12.5px] text-slate-600">
        {lead.phone}
      </td>
      <td className="whitespace-nowrap px-2.5 py-3 text-[12.5px] text-slate-600">{lead.city}</td>
      <td className="px-2.5 py-3">
        <LeadSourceBadge source={lead.source} />
      </td>
      <td className="px-2.5 py-3">
        <ScorePill score={lead.score} />
      </td>
      <td className="px-2.5 py-3">
        <LeadStatusBadge status={lead.status} />
      </td>
      <td className="whitespace-nowrap px-2.5 py-3 text-[12.5px] text-slate-600">
        {lead.assignedAgent ? `${lead.assignedAgent.name} (${lead.assignedAgent.language})` : "—"}
      </td>

      <td className="whitespace-nowrap px-2 py-3">
        {lastContact ? (
          <>
            <span className="tabular block text-[12.5px] text-brand-navy">{lastContact.date}</span>
            <span className="tabular block text-[11.5px] text-slate-400">{lastContact.time}</span>
          </>
        ) : (
          <span className="text-[12.5px] text-slate-400">-</span>
        )}
      </td>

      <td className="whitespace-nowrap px-2 py-3">
        {followUp ? (
          <>
            <span className="tabular block text-[12.5px] text-brand-navy">{followUp.date}</span>
            <span className="tabular block text-[11.5px] text-slate-400">{followUp.time}</span>
          </>
        ) : (
          <span className="text-[12.5px] text-slate-400">-</span>
        )}
      </td>

      <td className="py-3 pl-2 pr-4 text-right">
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Actions for ${lead.name}`}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          <MoreVertical className="h-4 w-4" strokeWidth={2} />
        </button>
      </td>
    </tr>
  );
}

export type { LeadStatus, LeadSource };
