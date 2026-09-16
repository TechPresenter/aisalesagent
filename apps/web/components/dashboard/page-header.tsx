import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HandwritingText } from "@/components/ui/handwriting-text";
import { tenantBranding } from "@/config/branding";

/**
 * Feature List §1 — page title and the primary campaign action.
 *
 * The tagline ends in a handwritten, self-rewriting word. It is the one place on a
 * dashboard where motion is not noise: the surrounding numbers are live, and a line that
 * keeps writing itself says so without another blinking dot.
 *
 * There was a date-range button here showing a fixed May 2025 range that filtered
 * nothing. It is gone until a range can actually be applied to every panel below; the
 * figures are workspace totals, and the trend covers the last 30 days.
 */
export function PageHeader() {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-brand-navy sm:text-display">
            AI Sales Agent
          </h1>
          <span className="mt-1 shrink-0 rounded-full bg-accent-blue/[0.13] px-2.5 py-1 text-[11px] font-bold text-accent-blue">
            Beta
          </span>
        </div>

        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[14px] text-slate-500">
          <span>Find. Call. Convert. Grow</span>
          <HandwritingText
            words={[
              `${tenantBranding.tenantName}.`,
              "your pipeline.",
              "every clinic.",
              "revenue.",
            ]}
            height="1.25em"
            duration={1.7}
            interval={3600}
            className="text-brand-green"
          />
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Button size="lg" asChild>
          <Link href="/campaigns?new=1">
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            New Campaign
          </Link>
        </Button>
      </div>
    </div>
  );
}
