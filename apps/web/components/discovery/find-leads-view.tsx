"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Lightbulb, Search, Sparkles, UserPlus } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FilterSelect } from "@/components/ui/filter-select";
import { ScorePill } from "@/components/ui/score-pill";
import { SOURCE_TONE, discoveredLeads, popularSearches } from "@/lib/mock-discovery";
import { cn } from "@/lib/utils";

const ALL = "all";
const PROMPT_LIMIT = 500;

/** Shown on every control that would need the discovery service to do anything. */
const NOT_CONNECTED = "AI lead discovery is not available yet. These rows are samples.";

/**
 * Feature List §3 — AI-powered lead discovery with a review-and-approve workflow.
 *
 * A preview over sample rows, reached only with NEXT_PUBLIC_FEATURE_FIND_LEADS on. What
 * works is what can honestly work without a data source: typing narrows the sample rows,
 * and the two filters narrow them by city and industry. Search, Add and Generate are
 * disabled rather than faked — an "Added" that adds nothing tells someone their lead is in
 * the pipeline when it is not. Filters that could not filter anything, a pager over
 * thousands of rows that do not exist and source totals are left out for the same reason.
 */
export function FindLeadsView() {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState(ALL);
  const [industry, setIndustry] = useState(ALL);
  const [prompt, setPrompt] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return discoveredLeads.filter((lead) => {
      if (term) {
        const matches =
          lead.name.toLowerCase().includes(term) ||
          lead.contactPerson.toLowerCase().includes(term) ||
          lead.industry.toLowerCase().includes(term) ||
          lead.city.toLowerCase().includes(term);
        if (!matches) return false;
      }
      if (city !== ALL && lead.city !== city) return false;
      if (industry !== ALL && lead.industry !== industry) return false;
      return true;
    });
  }, [query, city, industry]);

  const clearAll = () => {
    setQuery("");
    setCity(ALL);
    setIndustry(ALL);
  };

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_332px]">
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                strokeWidth={2}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by company, contact, industry or city..."
                aria-label="Filter the sample leads"
                className="h-11 w-full rounded-btn border border-slate-200 bg-surface pl-10 pr-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
              />
            </div>
            <button
              type="button"
              disabled
              title={NOT_CONNECTED}
              className="inline-flex h-11 shrink-0 cursor-not-allowed items-center gap-2 rounded-btn bg-accent-blue px-5 text-[14px] font-semibold text-white opacity-50"
            >
              <Search className="h-4 w-4" strokeWidth={2.4} />
              Search
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 text-[13px] font-semibold text-accent-blue hover:underline"
            >
              <RotateIcon />
              Clear All
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Location"
              value={city}
              onChange={setCity}
              className="w-[160px] flex-1"
              options={[
                { value: ALL, label: "All Cities" },
                ...Array.from(new Set(discoveredLeads.map((l) => l.city))).map((name) => ({
                  value: name,
                  label: name,
                })),
              ]}
            />
            <FilterSelect
              label="Industry"
              value={industry}
              onChange={setIndustry}
              className="w-[180px] flex-1"
              options={[
                { value: ALL, label: "All Industries" },
                ...Array.from(new Set(discoveredLeads.map((l) => l.industry))).map((name) => ({
                  value: name,
                  label: name,
                })),
              ]}
            />
          </div>
        </div>

        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50/80">
                <Th className="w-8 pl-4">#</Th>
                <Th>Company</Th>
                <Th>Industry</Th>
                <Th>City</Th>
                <Th>Phone</Th>
                <Th>Source</Th>
                <Th>Lead Score</Th>
                <Th className="pr-4">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, index) => (
                <tr key={lead.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="tabular py-3 pl-4 pr-2 text-[12.5px] text-slate-500">
                    {index + 1}
                  </td>
                  <td className="px-2.5 py-3">
                    <span className="block whitespace-nowrap text-[12.5px] font-semibold text-brand-navy">
                      {lead.name}
                    </span>
                    <span className="block text-[11.5px] text-slate-500">{lead.contactPerson}</span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-3 text-[12.5px] text-slate-600">
                    {lead.industry}
                  </td>
                  <td className="px-2.5 py-3 text-[12.5px] text-slate-600">{lead.city}</td>
                  <td className="tabular whitespace-nowrap px-2.5 py-3 text-[12.5px] text-slate-500">
                    <span className="sr-only">Number hidden in the sample: </span>
                    {lead.phone}
                  </td>
                  <td className="px-2.5 py-3">
                    <Badge tone={SOURCE_TONE[lead.source]}>{lead.source}</Badge>
                  </td>
                  <td className="px-2.5 py-3">
                    <ScorePill score={lead.score} />
                  </td>
                  <td className="py-3 pl-2.5 pr-4">
                    <button
                      type="button"
                      disabled
                      title={NOT_CONNECTED}
                      aria-label={`Add ${lead.name} to leads`}
                      className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-btn border border-accent-blue/30 px-3 text-[12px] font-semibold text-accent-blue opacity-50"
                    >
                      <UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} />
                      Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <p className="px-5 py-14 text-center text-[13.5px] text-slate-400">
              No sample rows match. Clear the filters to see them all.
            </p>
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-3">
          <p className="tabular text-[12.5px] text-slate-500">
            Showing {filtered.length} of {discoveredLeads.length} sample rows
          </p>
        </div>
      </Card>

      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-accent-purple" strokeWidth={2.2} />
            <CardTitle className="text-[16px]">AI Lead Search</CardTitle>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">
            Describe your ideal leads and let AI find them for you.
          </p>

          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, PROMPT_LIMIT))}
            rows={4}
            placeholder="Find logistics companies in Pune with a phone number and the name of the operations head."
            aria-label="Describe the leads you want"
            className="mt-3 w-full resize-none rounded-lg border border-slate-200 p-3 text-[12.5px] leading-relaxed text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
          />
          <p className="tabular mt-1 text-right text-[11px] text-slate-400">
            {prompt.length}/{PROMPT_LIMIT}
          </p>

          <button
            type="button"
            disabled
            title={NOT_CONNECTED}
            className="mt-2 flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-btn bg-brand-green text-[14px] font-semibold text-white opacity-50"
          >
            <Search className="h-4 w-4" strokeWidth={2.4} />
            Generate Leads with AI
          </button>

          <h3 className="mt-5 text-[13.5px] font-bold text-brand-navy">Example Searches</h3>
          <ul className="mt-2 space-y-1">
            {popularSearches.map((search) => (
              <li key={search}>
                <button
                  type="button"
                  onClick={() => setPrompt(search)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-purple/[0.13]">
                    <Sparkles className="h-3 w-3 text-accent-purple" strokeWidth={2.4} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-brand-navy">
                    {search}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="border-warning-amber/25 bg-warning-amber/[0.07] p-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-warning-amber" strokeWidth={2.2} />
            <h3 className="text-[14px] font-bold text-brand-navy">Tip</h3>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
            Name a location, an industry and a company size to get more accurate, higher-quality
            leads.
          </p>
        </Card>
      </div>
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

function RotateIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 12a9 9 0 1 1 3 6.7M3 20v-5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
