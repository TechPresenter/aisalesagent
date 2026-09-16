import type { Metadata } from "next";
import { PlansView } from "@/components/plans/plans-view";

export const metadata: Metadata = { title: "Plans & Pricing · AI Sales Agent" };

/**
 * Feature List §13 — Plans & Billing. The plan chooser, reached from the sidebar's
 * upgrade prompt and from Plan & Usage in Settings. Billing itself — invoices, payment
 * method, credit top-ups — stays on the Settings Billing tab.
 */
export default function PlansPage() {
  return <PlansView />;
}
