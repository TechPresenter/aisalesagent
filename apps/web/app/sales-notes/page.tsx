import type { Metadata } from "next";
import { SalesNotesScreen } from "@/components/notes/sales-notes-screen";

export const metadata: Metadata = { title: "Sales Notes · AI Sales Agent" };

/** Feature List §9 — Sales Notes. */
export default function SalesNotesPage() {
  return <SalesNotesScreen />;
}
