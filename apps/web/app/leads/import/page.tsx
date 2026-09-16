import type { Metadata } from "next";
import { CsvImport } from "@/components/leads/csv-import";

export const metadata: Metadata = {
  title: "Import Leads · AI Sales Agent",
};

/** Feature List §2 — Bulk CSV import with column mapping and de-duplication. */
export default function ImportLeadsPage() {
  return <CsvImport />;
}
