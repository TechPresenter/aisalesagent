import type { Metadata } from "next";
import { PageTitle } from "@/components/shared/page-title";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings · AI Sales Agent" };

/** Feature List §14 — Settings. */
export default function SettingsPage() {
  return (
    <>
      <PageTitle
        title="Settings"
        subtitle="Manage your profile, team, preferences and system settings."
      />
      <SettingsView />
    </>
  );
}
