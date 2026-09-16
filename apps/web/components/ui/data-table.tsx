import * as React from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

/**
 * Brand Guidelines §5 (Tables): white background, light-grey header row, 1px row
 * dividers, row-hover highlight. The status column is a badge because the caller passes
 * a badge in the cell renderer — the table itself stays generic.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "Nothing to show yet.",
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-[13px] text-slate-400">{emptyMessage}</p>
    );
  }

  return (
    // `relative` is load-bearing: cells may hold absolutely-positioned content (an
    // sr-only label, a popover), and without a positioned ancestor here those escape the
    // scroll container entirely and widen the whole page instead of being clipped.
    <div className="relative w-full overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[500px] border-collapse text-left">
        <thead>
          <tr className="bg-slate-50/80">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row)}
              className="border-t border-slate-100 transition-colors hover:bg-slate-50/70"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap px-3 py-3 text-[12.5px] text-brand-navy",
                    col.className,
                  )}
                >
                  {col.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
