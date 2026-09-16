import type { Metadata } from "next";
import { PageTitle } from "@/components/shared/page-title";
import { SettingsView, type SettingsQuery } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings · AI Sales Agent" };

/** The first value of a query parameter that may have been repeated. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Feature List §14 — Settings. `?tab=` opens a tab directly; the OAuth callback also adds
 * `connected` or `integration_error` when it sends someone back here.
 */
export default function SettingsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query: SettingsQuery = {
    tab: first(searchParams.tab),
    connected: first(searchParams.connected),
    integration_error: first(searchParams.integration_error),
  };

  return (
    <>
      <PageTitle
        title="Settings"
        subtitle="Manage your profile, team, preferences and system settings."
      />
      <SettingsView query={query} />
    </>
  );
}
