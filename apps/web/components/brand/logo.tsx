import { appBrand } from "@/config/app-brand";
import { cn } from "@/lib/utils";

/**
 * The Appsgain lockup: the gradient "ag" monogram, a hairline rule, then the stacked
 * wordmark with its tagline.
 *
 * Drawn rather than linked so it stays crisp at every size, needs no network request and
 * inherits the page's own colour where it has to (`onDark`). To swap in the supplied
 * artwork instead, drop it at `public/logo.svg` and replace `<Mark>` below — every screen
 * reads this one component, so nothing else changes.
 */

const SIZES = {
  sm: { mark: 28, title: "text-[13.5px]", sub: "text-[8px]", tag: "text-[6.5px]", gap: "gap-2" },
  md: { mark: 38, title: "text-[18px]", sub: "text-[11px]", tag: "text-[8px]", gap: "gap-2.5" },
  lg: { mark: 46, title: "text-[22px]", sub: "text-[13.5px]", tag: "text-[9px]", gap: "gap-3" },
} as const;

export type LogoSize = keyof typeof SIZES;

export function Logo({
  size = "md",
  onDark = false,
  className,
}: {
  size?: LogoSize;
  /** Flips the wordmark to white for the navy sidebar; the mark keeps its gradient. */
  onDark?: boolean;
  className?: string;
}) {
  const s = SIZES[size];

  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <Mark size={s.mark} />

      <span
        aria-hidden
        className={cn("h-[78%] w-px shrink-0", onDark ? "bg-white/25" : "bg-slate-300")}
        style={{ minHeight: s.mark * 0.68 }}
      />

      <span className="min-w-0 leading-none">
        <span
          className={cn(
            "block font-extrabold lowercase leading-[1.05] tracking-tight",
            s.title,
            onDark ? "text-white" : "text-brand-navy",
          )}
        >
          {appBrand.nameLines[0]}
        </span>
        <span
          className={cn(
            "block font-extrabold lowercase leading-[1.05] tracking-tight",
            s.sub,
            onDark ? "text-white" : "text-brand-navy",
          )}
        >
          {appBrand.nameLines[1]}
        </span>
        <span
          className={cn(
            "mt-[3px] block whitespace-nowrap font-semibold uppercase tracking-[0.16em]",
            s.tag,
            onDark ? "text-white/55" : "text-slate-400",
          )}
        >
          {appBrand.tagline}
        </span>
      </span>

      <span className="sr-only">{appBrand.name}</span>
    </span>
  );
}

/**
 * The "ag" monogram on its own — for the collapsed sidebar, the favicon and anywhere the
 * wordmark would not fit.
 *
 * Two rings sharing a baseline: the "a" is a closed bowl with a stem, the "g" the same
 * bowl with a descender that hooks back under it. Both are stroked with one gradient so
 * the colour runs continuously across the pair, as it does in the artwork.
 */
export function Mark({ size = 38, className }: { size?: number; className?: string }) {
  const id = "ag-mark-gradient";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={appBrand.name}
    >
      <defs>
        {/* Angled so the ramp runs across the pair rather than down each letter: the
            "a" sits in the orange end and the "g" descender in the violet, as in the
            artwork. */}
        <linearGradient id={id} x1="4" y1="10" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor={appBrand.gradient.from} />
          <stop offset="0.22" stopColor="#F3452F" />
          <stop offset="0.62" stopColor={appBrand.gradient.via} />
          <stop offset="1" stopColor={appBrand.gradient.to} />
        </linearGradient>
      </defs>

      {/* "a" — bowl plus stem. */}
      <circle cx="16.5" cy="24" r="8.5" stroke={`url(#${id})`} strokeWidth="6" />
      <path
        d="M25 15.5v17"
        stroke={`url(#${id})`}
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* "g" — the same bowl, with the descender hooking back beneath it. */}
      <circle cx="31.5" cy="24" r="8.5" stroke={`url(#${id})`} strokeWidth="6" />
      <path
        d="M40 15.5v20a8 8 0 0 1-8 8h-4.5"
        stroke={`url(#${id})`}
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
