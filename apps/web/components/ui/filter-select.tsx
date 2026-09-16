"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  className?: string;
}

/**
 * A labelled dropdown for the Leads filter bar.
 *
 * Built on a native <select> rather than a custom listbox. That is a deliberate trade:
 * a custom control would match the mock's chevron more exactly, but the native element
 * brings keyboard behaviour, type-ahead and the platform's own picker on touch devices
 * for free — and on a filter bar of six of them, that is worth more than the pixels. The
 * select is made transparent and overlaid on styled chrome so it still looks the part.
 */
export function FilterSelect({ label, value, options, onChange, className }: FilterSelectProps) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 block text-[12px] font-medium text-slate-500">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-btn border border-slate-200 bg-surface pl-3 pr-9 text-[13px] font-medium text-brand-navy transition-colors hover:bg-slate-50 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          strokeWidth={2}
        />
      </span>
    </label>
  );
}
