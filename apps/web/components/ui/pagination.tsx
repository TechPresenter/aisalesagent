"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

/**
 * Builds the visible page list: always the first pages, the current neighbourhood and
 * the last page, with an ellipsis standing in for the gap.
 *
 * The window is fixed-width on purpose. A naive "current ± 2" list changes length as you
 * move through the pages, so the last-page button and the row of numbers shift sideways
 * under the cursor between clicks — which is exactly when someone is clicking repeatedly.
 */
export function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (page <= 4) {
    return [1, 2, 3, 4, 5, "gap", totalPages];
  }

  if (page >= totalPages - 3) {
    return [1, "gap", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "gap", page - 1, page, page + 1, "gap", totalPages];
}

export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <PageButton
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        label="Previous page"
      >
        <ChevronsLeft className="h-4 w-4" strokeWidth={2} />
      </PageButton>

      {pages.map((entry, index) =>
        entry === "gap" ? (
          <span
            key={`gap-${index}`}
            aria-hidden
            className="px-1.5 text-[13px] text-slate-400"
          >
            &hellip;
          </span>
        ) : (
          <PageButton
            key={entry}
            onClick={() => onChange(entry)}
            active={entry === page}
            label={`Page ${entry}`}
            current={entry === page}
          >
            {entry}
          </PageButton>
        ),
      )}

      <PageButton
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        label="Next page"
      >
        <ChevronsRight className="h-4 w-4" strokeWidth={2} />
      </PageButton>
    </nav>
  );
}

function PageButton({
  children,
  onClick,
  active,
  disabled,
  label,
  current,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  current?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={cn(
        "tabular flex h-8 min-w-[32px] items-center justify-center rounded-md px-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-accent-blue text-white"
          : "text-brand-navy hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300",
      )}
    >
      {children}
    </button>
  );
}
