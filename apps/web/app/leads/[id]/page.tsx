import type { Metadata } from "next";
import { LeadDetailScreen } from "@/components/leads/lead-detail-screen";

export const metadata: Metadata = { title: "Lead Details" };

interface PageProps {
  params: { id: string };
}

/**
 * Feature List §2 — Lead detail view. The record is read in the browser, like every other
 * authenticated screen, because the access token lives in session storage and the server
 * never sees it.
 */
export default function LeadDetailPage({ params }: PageProps) {
  return <LeadDetailScreen id={params.id} />;
}
