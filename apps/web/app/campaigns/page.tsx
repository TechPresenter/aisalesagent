import type { Metadata } from "next";
import { CampaignsScreen } from "@/components/campaigns/campaigns-screen";

export const metadata: Metadata = { title: "Campaigns · AI Sales Agent" };

/**
 * Feature List §4 — Campaigns. `?new=1` — the dashboard's New Campaign button — opens
 * the create dialog on arrival.
 */
export default function CampaignsPage({ searchParams }: { searchParams: { new?: string } }) {
  return <CampaignsScreen startCreating={searchParams.new === "1"} />;
}
