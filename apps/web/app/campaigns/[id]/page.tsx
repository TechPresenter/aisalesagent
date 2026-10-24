import type { Metadata } from "next";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";

export const metadata: Metadata = { title: "Campaign · AI Sales Agent" };

interface PageProps {
  params: { id: string };
}

/**
 * Feature List §4 — one campaign: its settings, its leads and the switch that starts it
 * dialling. Seven screens link here (calendar, AI calling, recordings, transcripts, the
 * campaign list, follow-ups and sales notes). The record is read in the browser, like
 * every authenticated screen, because the access token never reaches the server.
 */
export default function CampaignPage({ params }: PageProps) {
  return <CampaignDetail id={params.id} />;
}
