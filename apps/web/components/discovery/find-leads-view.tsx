"use client";

import { useMemo, useState } from "react";
import {
  Bookmark,
  ChevronRight,
  Download,
  Lightbulb,
  MoreVertical,
  Search,
  Sparkles,
  SlidersHorizontal,
  UserPlus,
  X,
} from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FilterSelect } from "@/components/ui/filter-select";
import { Pagination } from "@/components/ui/pagination";
import { ScorePill } from "@/components/ui/score-pill";
import { DonutChart } from "@/components/ui/donut-chart";
import {
  SOURCE_TONE,
  discoveredLeads,
  discoverySources,
  discoveryTotals,
  popularSearches,
} from "@/lib/mock-discovery";
import { TONE_HEX } from "@/lib/status";
import { cn, formatNumber } from "@/lib/utils";

const ALL = "all";
const PAGE_SIZE = 10;
const PROMPT_LIMIT = 500;

/** Feature List §3 — AI-powered lead discovery with a review-and-approve workflow. */
export function FindLeadsView() {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState(ALL);
  const [specialty, setSpecialty] = useState(ALL);
  const [clinicType, setClinicType] = useState(ALL);
  const [doctors, setDoctors] = useState(ALL);
  const [verified, setVerified] = useState(ALL);
  const [page, setPage] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // The chips under the filter row are the applied criteria, removable individually.
  const [chips, setChips] = useState<string[]>(["Dental Clinic", "Patna", "Verified"]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return discoveredLeads.filter((lead) => {
      if (term) {
        const matches =
          lead.name.toLowerCase().includes(term) ||
          lead.contactPerson.toLowerCase().includes(term) ||
          lead.specialty.toLowerCase().includes(term) ||
          lead.city.toLowerCase().includes(term);
        if (!matches) return false;
      }
      if (city !== ALL && lead.city !== city) return false;
      if (specialty !== ALL && lead.specialty !== specialty) return false;
      return true;
    });
  }, [query, city, specialty]);

  const clearAll = () => {
    setQuery("");
    setCity(ALL);
    setSpecialty(ALL);
    setClinicType(ALL);
    setDoctors(ALL);
    setVerified(ALL);
    setChips([]);
    setPage(1);
  };

  const totalPages = Math.ceil(discoveryTotals.clinicsFound / PAGE_SIZE);

  const donutData = discoverySources.map((source) => ({
    label: source.label,
    value: source.value,
    color: TONE_HEX[source.tone],
  }));

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
                placeholder="Search by clinic name, doctor name, speciality, or location..."
                aria-label="Search discovered leads"
                className="h-11 w-full rounded-btn border border-slate-200 bg-surface pl-10 pr-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
              />
            </div>
            <button
              type="button"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-btn bg-accent-blue px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
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
              className="w-[140px] flex-1"
              options={[
                { value: ALL, label: "All Cities" },
                ...Array.from(new Set(discoveredLeads.map((l) => l.city))).map((name) => ({
                  value: name,
                  label: name,
                })),
              ]}
            />
            <FilterSelect
              label="Specialty"
              value={specialty}
              onChange={setSpecialty}
              className="w-[150px] flex-1"
              options={[
                { value: ALL, label: "All Specialties" },
                ...Array.from(new Set(discoveredLeads.map((l) => l.specialty))).map((name) => ({
                  value: name,
                  label: name,
                })),
              ]}
            />
            <FilterSelect
              label="Clinic Type"
              value={clinicType}
              onChange={setClinicType}
              className="w-[140px] flex-1"
              options={[
                { value: ALL, label: "All Types" },
                { value: "clinic", label: "Clinic" },
                { value: "hospital", label: "Hospital" },
                { value: "lab", label: "Diagnostic Lab" },
              ]}
            />
            <FilterSelect
              label="Number of Doctors"
              value={doctors}
              onChange={setDoctors}
              className="w-[150px] flex-1"
              options={[
                { value: ALL, label: "Any" },
                { value: "1", label: "1 doctor" },
                { value: "2-5", label: "2 – 5 doctors" },
                { value: "5+", label: "5+ doctors" },
              ]}
            />
            <FilterSelect
              label="Verified"
              value={verified}
              onChange={setVerified}
              className="w-[120px] flex-1"
              options={[
                { value: ALL, label: "All" },
                { value: "yes", label: "Verified only" },
                { value: "no", label: "Unverified" },
              ]}
            />
            <button
              type="button"
              disabled
              title="AI lead discovery is not connected yet."
              className="inline-flex h-10 shrink-0 cursor-not-allowed items-center gap-2 rounded-btn border border-slate-200 px-3.5 text-[13px] font-medium text-accent-blue opacity-50"
            >
              <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
              More Filters
            </button>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-blue/[0.13] py-1 pl-2.5 pr-1.5 text-[11.5px] font-semibold text-accent-blue"
                >
                  {chip}
                  <button
                    type="button"
                    onClick={() => setChips((current) => current.filter((c) => c !== chip))}
                    aria-label={`Remove filter ${chip}`}
                    className="rounded-full p-0.5 transition-colors hover:bg-accent-blue/20"
                  >
                    <X className="h-3 w-3" strokeWidth={2.6} />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled
                title="AI lead discovery is not connected yet."
                className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-[12.5px] font-medium text-brand-navy opacity-50"
              >
                <Bookmark className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
                Save Search
              </button>
              <button
                type="button"
                disabled
                title="These results are samples, so there is nothing real to export."
                className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-[12.5px] font-medium text-brand-navy opacity-50"
              >
                <Download className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
                Export Results
              </button>
            </div>
          </div>
        </div>

        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50/80">
                <Th className="w-9 pl-4">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((l) => checked.has(l.id))}
                    onChange={() =>
                      setChecked(
                        filtered.every((l) => checked.has(l.id))
                          ? new Set()
                          : new Set(filtered.map((l) => l.id)),
                      )
                    }
                    aria-label="Select all discovered leads"
                    className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#237DF5]"
                  />
                </Th>
                <Th className="w-8">#</Th>
                <Th>Clinic / Business Name</Th>
                <Th>Specialty</Th>
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
                  <td className="py-3 pl-4 pr-2">
                    <input
                      type="checkbox"
                      checked={checked.has(lead.id)}
                      onChange={() => {
                        const next = new Set(checked);
                        if (next.has(lead.id)) next.delete(lead.id);
                        else next.add(lead.id);
                        setChecked(next);
                      }}
                      aria-label={`Select ${lead.name}`}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#237DF5]"
                    />
                  </td>
                  <td className="tabular px-2 py-3 text-[12.5px] text-slate-500">{index + 1}</td>
                  <td className="px-2.5 py-3">
                    <span className="block whitespace-nowrap text-[12.5px] font-semibold text-brand-navy">
                      {lead.name}
                    </span>
                    <span className="block text-[11.5px] text-slate-500">{lead.contactPerson}</span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-3 text-[12.5px] text-slate-600">
                    {lead.specialty}
                  </td>
                  <td className="px-2.5 py-3 text-[12.5px] text-slate-600">{lead.city}</td>
                  <td className="tabular whitespace-nowrap px-2.5 py-3 text-[12.5px] text-brand-navy">
                    {lead.phone}
                  </td>
                  <td className="px-2.5 py-3">
                    <Badge tone={SOURCE_TONE[lead.source]}>{lead.source}</Badge>
                  </td>
                  <td className="px-2.5 py-3">
                    <ScorePill score={lead.score} />
                  </td>
                  <td className="py-3 pl-2.5 pr-4">
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setAdded((current) => new Set(current).add(lead.id))}
                        disabled={added.has(lead.id)}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-btn px-3 text-[12px] font-semibold transition-colors",
                          added.has(lead.id)
                            ? "bg-brand-green/[0.13] text-deep-green"
                            : "border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/[0.07]",
                        )}
                      >
                        <UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} />
                        {added.has(lead.id) ? "Added" : "Add"}
                      </button>
                      <button
                        type="button"
                        aria-label={`Actions for ${lead.name}`}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
                      >
                        <MoreVertical className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <p className="px-5 py-14 text-center text-[13.5px] text-slate-400">
              No results. Try widening the filters or describing what you want on the right.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="tabular text-[12.5px] text-slate-500">
            Showing 1 to {filtered.length} of {formatNumber(discoveryTotals.clinicsFound)} leads
          </p>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
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
            placeholder="Find dental clinics in Patna with phone number, owner name and email if available."
            aria-label="Describe the leads you want"
            className="mt-3 w-full resize-none rounded-lg border border-slate-200 p-3 text-[12.5px] leading-relaxed text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
          />
          <p className="tabular mt-1 text-right text-[11px] text-slate-400">
            {prompt.length}/{PROMPT_LIMIT}
          </p>

          <button
            type="button"
            disabled
            title="AI lead discovery is not connected yet."
            className="mt-2 flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-btn bg-brand-green text-[14px] font-semibold text-white opacity-50"
          >
            <Search className="h-4 w-4" strokeWidth={2.4} />
            Generate Leads with AI
          </button>

          <h3 className="mt-5 text-[13.5px] font-bold text-brand-navy">Popular Searches</h3>
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

        <Card className="p-4">
          <CardTitle className="text-[16px]">Lead Sources</CardTitle>
          <div className="mt-3 flex items-center gap-4">
            <DonutChart
              data={donutData}
              centerValue={discoveryTotals.clinicsFound}
              centerLabel="Total Leads"
              size={118}
            />
            <ul className="min-w-0 flex-1 space-y-1.5">
              {discoverySources.map((source) => (
                <li key={source.label} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: TONE_HEX[source.tone] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">
                    {source.label}
                  </span>
                  <span className="tabular shrink-0 text-[12px] font-semibold text-brand-navy">
                    {source.percent}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="border-warning-amber/25 bg-warning-amber/[0.07] p-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-warning-amber" strokeWidth={2.2} />
            <h3 className="text-[14px] font-bold text-brand-navy">Pro Tip</h3>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
            Use specific location, specialty and clinic type to get more accurate and high-quality
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
