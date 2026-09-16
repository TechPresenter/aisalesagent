import { DashboardScreen } from "@/components/dashboard/dashboard-screen";

/**
 * Build Plan Phase 3 — the dashboard. Its figures are read in the browser, like every
 * other authenticated screen, because the access token lives in session storage.
 */
export default function DashboardPage() {
  return <DashboardScreen />;
}
