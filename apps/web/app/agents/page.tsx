import type { Metadata } from "next";
import { AgentsScreen } from "@/components/agents/agents-screen";

export const metadata: Metadata = { title: "AI Agents · AI Sales Agent" };

/** Feature List §12 — AI Agents. */
export default function AgentsPage() {
  return <AgentsScreen />;
}
