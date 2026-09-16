import { cn } from "@/lib/utils";
import { TONE_BADGE, scoreTone } from "@/lib/status";

/**
 * Feature List §2 — the 0–100 AI lead score as a table pill.
 *
 * The band comes from `scoreTone` rather than being decided here, so the same 74 is the
 * same amber in the table, the side panel and the detail header. Rendered with tabular
 * figures because it sits in a column of numbers that must line up.
 */
export function ScorePill({ score, className }: { score: number; className?: string }) {
  return (
    <span
      className={cn(
        "tabular inline-flex h-6 min-w-[34px] items-center justify-center rounded-full px-2 text-[12px] font-bold leading-none",
        TONE_BADGE[scoreTone(score)],
        className,
      )}
      // The pill shows a bare number; a screen reader should hear what it measures.
      aria-label={`Lead score ${score} out of 100`}
    >
      {score}
    </span>
  );
}

/**
 * The larger score block used on the detail header and the side panel: the number over
 * "/100" with its label underneath, on a tinted ground.
 */
export function ScoreBlock({ score, className }: { score: number; className?: string }) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-xl px-4 py-2.5 text-center",
        TONE_BADGE[scoreTone(score)],
        className,
      )}
    >
      <p className="tabular text-[24px] font-bold leading-none">
        {score}
        <span className="text-[13px] font-semibold opacity-70">/100</span>
      </p>
      <p className="mt-1 text-[11px] font-semibold leading-none opacity-80">Lead Score</p>
    </div>
  );
}
