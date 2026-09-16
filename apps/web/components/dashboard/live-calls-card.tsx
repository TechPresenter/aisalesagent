"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { CallStatusBadge } from "@/components/ui/status-badge";
import { formatDuration } from "@/lib/utils";
import type { LiveCall } from "@/lib/types";

/**
 * Working Flow §Flow 4 — the Live Calls table. Purely presentational: the call list and
 * the selection both live in <LiveCallsSection>, so this table and the detail panel
 * beside it can never disagree about a call's duration.
 */
export function LiveCallsCard({
  calls,
  selectedId,
  onSelect,
}: {
  calls: LiveCall[];
  selectedId: string;
  onSelect: (call: LiveCall) => void;
}) {
  const columns: Column<LiveCall>[] = [
    {
      key: "index",
      header: "#",
      headerClassName: "w-10",
      className: "tabular text-slate-400",
      cell: (_row, i) => i + 1,
    },
    {
      key: "phone",
      header: "Phone Number",
      className: "tabular font-medium",
      cell: (row) => row.phone,
    },
    { key: "clinic", header: "Clinic / Name", cell: (row) => row.clinicName },
    { key: "city", header: "City", className: "text-slate-500", cell: (row) => row.city },
    {
      key: "duration",
      header: "Duration",
      className: "tabular text-slate-500",
      cell: (row) => formatDuration(row.duration),
    },
    { key: "status", header: "Status", cell: (row) => <CallStatusBadge status={row.status} /> },
    {
      key: "agent",
      header: "AI Agent",
      className: "text-slate-500",
      cell: (row) => `${row.persona.name} (${row.persona.language})`,
    },
    {
      key: "select",
      header: <span className="sr-only">Show call details</span>,
      headerClassName: "w-12",
      // A real button per row rather than a click handler on <tr>: the panel beside the
      // table is driven by keyboard and pointer alike, and the table stays a table.
      cell: (row) => (
        <button
          type="button"
          onClick={() => onSelect(row)}
          aria-pressed={row.id === selectedId}
          className={
            row.id === selectedId
              ? "rounded-md bg-brand-green/15 px-2 py-1 text-[11.5px] font-semibold text-deep-green"
              : "rounded-md px-2 py-1 text-[11.5px] font-semibold text-accent-blue transition-colors hover:bg-accent-blue/10"
          }
        >
          {row.id === selectedId ? "Viewing" : "View"}
          <span className="sr-only"> details for {row.clinicName}</span>
        </button>
      ),
    },
  ];

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <CardTitle>
          Live Calls{" "}
          <span className="tabular text-[13px] font-normal text-slate-400">
            ({calls.length} in progress)
          </span>
        </CardTitle>
        <Link
          href="/ai-calling"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-btn border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-brand-navy transition-colors hover:bg-slate-50"
        >
          View All Calls
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </CardHeader>

      <div className="mt-4">
        <DataTable
          columns={columns}
          rows={calls}
          rowKey={(row) => row.id}
          emptyMessage="No calls in progress."
        />
      </div>
    </Card>
  );
}
