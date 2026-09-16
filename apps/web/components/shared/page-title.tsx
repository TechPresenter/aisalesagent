import { cn } from "@/lib/utils";

/**
 * The heading block every workspace page opens with: title, one-line subtitle and the
 * page's primary actions on the right. Extracted because six screens repeat it exactly,
 * and a title that drifts a pixel between pages is the kind of thing nobody notices
 * individually and everybody notices in aggregate.
 */
export function PageTitle({
  title,
  subtitle,
  badge,
  actions,
  className,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-brand-navy sm:text-display">
            {title}
          </h1>
          {badge && (
            <span className="mt-1 shrink-0 rounded-full bg-accent-blue/[0.13] px-2.5 py-1 text-[11px] font-bold text-accent-blue">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[14px] text-slate-500">{subtitle}</p>
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

/** The date-range control that sits beside the primary action on several screens. */
export function DateRangeButton({ label = "May 1, 2025 – May 31, 2025" }: { label?: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-11 items-center gap-2.5 rounded-btn border border-slate-200 bg-surface px-3.5 text-[13px] font-medium text-brand-navy transition-colors hover:bg-slate-50"
    >
      <CalendarIcon />
      <span className="tabular">{label}</span>
      <ChevronIcon />
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
