import type { Metadata } from "next";
import { Bookmark, Building2, PhoneCall, Plus, Users } from "lucide-react";
import { PageTitle } from "@/components/shared/page-title";
import { StatStrip, type StatSpec } from "@/components/shared/stat-strip";
import { FindLeadsView } from "@/components/discovery/find-leads-view";
import { discoveryTotals } from "@/lib/mock-discovery";

export const metadata: Metadata = { title: "Find Leads (AI) · AI Sales Agent" };

const STATS: StatSpec[] = [
  { id: "found", label: "Clinics Found", value: discoveryTotals.clinicsFound, trend: 32, sparkline: [5200, 6100, 6800, 7400, 8200, 8900, 9600, 10200, 10900, 11500, 12000, 12480], icon: Users, tone: "purple" },
  { id: "verified", label: "Verified Leads", value: discoveryTotals.verifiedLeads, trend: 28, sparkline: [3400, 4000, 4500, 4900, 5400, 5900, 6300, 6800, 7200, 7600, 7950, 8230], icon: Building2, tone: "green" },
  { id: "numbers", label: "Contact Numbers", value: discoveryTotals.contactNumbers, trend: 41, sparkline: [1400, 1650, 1900, 2100, 2350, 2550, 2750, 2950, 3150, 3320, 3450, 3560], icon: PhoneCall, tone: "blue" },
];

/** Feature List §3 — Find Leads (AI). */
export default function FindLeadsPage() {
  return (
    <>
      <PageTitle
        title="Find Leads (AI)"
        badge="Beta"
        subtitle="Use AI to find new clinics, doctors and healthcare businesses."
        actions={
          <>
            <button
              type="button"
              disabled
              title="AI lead discovery is not connected yet."
              className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-btn border border-slate-200 bg-surface px-5 text-[14.5px] font-semibold text-brand-navy opacity-50"
            >
              <Bookmark className="h-4 w-4" strokeWidth={2.2} />
              Saved Searches
            </button>
            <button
              type="button"
              disabled
              title="AI lead discovery is not connected yet."
              className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-btn bg-accent-blue px-5 text-[14.5px] font-semibold text-white opacity-50"
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} />
              New Search
            </button>
          </>
        }
      />

      {/* The one thing a visitor to this screen has to know, before the numbers below it
          are read as the workspace's own. */}
      <p className="mb-5 rounded-btn bg-warning-amber/[0.1] px-4 py-2.5 text-[13px] font-medium text-[#B4761A]">
        AI lead discovery is not connected yet. Everything on this page is sample data, kept so
        the flow can be reviewed — nothing here is searched, saved or imported. Real leads come
        from Leads &rarr; Import, or from the API.
      </p>

      <StatStrip stats={STATS} columns={3} />

      <div className="mt-5">
        <FindLeadsView />
      </div>
    </>
  );
}
