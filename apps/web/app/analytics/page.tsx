import type { Metadata } from "next";
import { AnalyticsScreen } from "@/components/analytics/analytics-screen";

export const metadata: Metadata = { title: "Analytics · AI Sales Agent" };

/** Feature List §11 — Analytics. The figures are read in the browser (see AnalyticsScreen). */
export default function AnalyticsPage() {
  return <AnalyticsScreen />;
}
