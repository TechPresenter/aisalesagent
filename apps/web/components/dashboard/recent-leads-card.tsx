import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LeadSourceBadge, LeadStatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import type { Lead } from "@/lib/types";

/** Feature List §1 — Recent Leads, newest first, each opening its detail page. */
export function RecentLeadsCard({ leads, loading }: { leads: Lead[]; loading?: boolean }) {
  const columns: Column<Lead>[] = [
    {
      key: "name",
      header: "Name / Clinic",
      className: "font-semibold",
      cell: (row) => (
        <Link href={`/leads/${row.id}`} className="hover:text-brand-green">
          {row.name}
        </Link>
      ),
    },
    { key: "phone", header: "Phone", className: "tabular text-slate-600", cell: (row) => row.phone },
    { key: "city", header: "City", className: "text-slate-500", cell: (row) => row.city },
    { key: "source", header: "Source", cell: (row) => <LeadSourceBadge source={row.source} /> },
    { key: "status", header: "Status", cell: (row) => <LeadStatusBadge status={row.status} /> },
    {
      key: "added",
      header: "Added On",
      className: "tabular text-slate-500",
      cell: (row) => formatDate(row.addedOn),
    },
  ];

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <CardTitle>Recent Leads</CardTitle>
        <Link
          href="/leads"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-btn border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-brand-navy transition-colors hover:bg-slate-50"
        >
          View All
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </CardHeader>
      <div className="mt-4">
        <DataTable
          columns={columns}
          rows={leads}
          rowKey={(row) => row.id}
          emptyMessage={loading ? "Loading leads…" : "No leads yet."}
        />
      </div>
    </Card>
  );
}
