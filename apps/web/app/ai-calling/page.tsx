import type { Metadata } from "next";
import { PageTitle } from "@/components/shared/page-title";
import { AiCallingView } from "@/components/calls/ai-calling-view";

export const metadata: Metadata = { title: "AI Calling · AI Sales Agent" };

/** Feature List §5 — AI Calling (Live Console). */
export default function AiCallingPage() {
  return (
    <>
      <PageTitle
        title="AI Calling"
        subtitle="Let our AI agents call, qualify and convert leads automatically."
      />

      <AiCallingView />
    </>
  );
}
