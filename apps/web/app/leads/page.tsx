import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadIntakeActions } from "@/components/leads/add-lead-dialog";
import { LeadsBrowser } from "@/components/leads/leads-browser";
import { LeadStatsStrip } from "@/components/leads/lead-stats-strip";
import { features } from "@/config/features";

export const metadata: Metadata = {
  title: "Leads · AI Sales Agent",
};

/**
 * Feature List §2 — Leads Management. `?search=` comes from the header's search box; the
 * browser is keyed on it so a second search from the header replaces the first.
 *
 * Add Lead and Import are the primary actions because they are how a workspace's own
 * leads get in. Find Leads (AI) sits beside them as a quieter link, when its feature
 * switch is on (config/features.ts).
 */
export default function LeadsPage({ searchParams }: { searchParams: { search?: string } }) {
  const search = searchParams.search ?? "";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-brand-navy sm:text-display">
            Leads
          </h1>
          <p className="mt-1.5 text-[14px] text-slate-500">
            Manage, qualify, and convert your B2B leads.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {features.findLeads && (
            <Button variant="ghost" size="lg" asChild>
              <Link href="/find-leads">
                <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                Find Leads (AI)
              </Link>
            </Button>
          )}
          <LeadIntakeActions />
        </div>
      </div>

      <LeadStatsStrip />

      <LeadsBrowser key={search} initialSearch={search} />
    </>
  );
}
