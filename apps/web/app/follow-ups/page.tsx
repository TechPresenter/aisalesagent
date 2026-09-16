import type { Metadata } from "next";
import { FollowUpsScreen } from "@/components/followups/follow-ups-screen";

export const metadata: Metadata = { title: "Follow-ups · AI Sales Agent" };

/** Feature List §10 — Follow-ups & Tasks. */
export default function FollowUpsPage() {
  return <FollowUpsScreen />;
}
