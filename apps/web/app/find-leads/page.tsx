import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageTitle } from "@/components/shared/page-title";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FindLeadsView } from "@/components/discovery/find-leads-view";
import { LeadIntakeActions } from "@/components/leads/add-lead-dialog";
import { features } from "@/config/features";

export const metadata: Metadata = { title: "Find Leads (AI) · AI Sales Agent" };

/**
 * Feature List §3 — Find Leads (AI).
 *
 * Discovery needs a licensed source of business data, and there is none yet. So by
 * default this route is a "coming soon" page that points at the ways leads do get in
 * today, and nothing in the app links here (config/navigation.ts, the Leads page). With
 * NEXT_PUBLIC_FEATURE_FIND_LEADS on, it shows the screen's design over sample rows, for
 * reviewing the flow — still with no figures, because there is nothing to count.
 */
export default function FindLeadsPage() {
  if (!features.findLeads) return <ComingSoon />;

  return (
    <>
      <PageTitle
        title="Find Leads (AI)"
        badge="Preview"
        subtitle="Use AI to find businesses that match your ideal customer."
      />

      {/* The one thing a visitor to this screen has to know, before the rows below are
          read as the workspace's own. */}
      <p className="mb-5 rounded-btn bg-warning-amber/[0.1] px-4 py-2.5 text-[13px] font-medium text-[#B4761A]">
        AI lead discovery is not available yet. Everything on this page is sample data, kept so the
        flow can be reviewed — nothing here is searched, saved or imported. Real leads come from
        Leads &rarr; Add Lead or Import.
      </p>

      <FindLeadsView />
    </>
  );
}

function ComingSoon() {
  return (
    <>
      <PageTitle
        title="Find Leads (AI)"
        badge="Coming soon"
        subtitle="Use AI to find businesses that match your ideal customer."
      />

      <Card className="flex flex-col items-center px-6 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-purple/[0.13]">
          <Sparkles className="h-6 w-6 text-accent-purple" strokeWidth={2} />
        </span>
        <h2 className="mt-4 text-[19px] font-bold tracking-tight text-brand-navy">
          AI lead discovery is coming soon
        </h2>
        <p className="mt-2 max-w-[460px] text-[13.5px] leading-relaxed text-slate-500">
          Describe the businesses you want to reach, and review the leads AI finds before any of
          them join your pipeline. Until then, add leads one at a time or import a CSV file.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button variant="ghost" asChild>
            <Link href="/leads">Go to Leads</Link>
          </Button>
          <LeadIntakeActions size="md" />
        </div>
      </Card>
    </>
  );
}
