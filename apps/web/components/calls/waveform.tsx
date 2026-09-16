import { cn } from "@/lib/utils";

/**
 * The audio waveform on the call player and the live-call panel.
 *
 * Bar heights come from a fixed sequence rather than `Math.random()`. Two reasons: a
 * random waveform would differ between the server render and the client hydration, which
 * React reports as a mismatch; and a waveform that reshuffles on every re-render reads as
 * a bug even when nothing is wrong.
 *
 * `progress` tints the played portion, so the same component serves the static player and
 * the live monitor.
 */
const PATTERN = [
  0.3, 0.55, 0.4, 0.75, 0.5, 0.9, 0.65, 1, 0.7, 0.45, 0.6, 0.35, 0.8, 0.55, 0.95, 0.6, 0.4,
  0.7, 0.5, 0.85, 0.45, 0.65, 0.3, 0.75, 0.55, 0.9, 0.5, 0.7, 0.4, 0.6, 0.8, 0.45, 0.65,
  0.35, 0.85, 0.55, 0.75, 0.5, 0.95, 0.4,
];

export function Waveform({
  bars = 40,
  height = 34,
  progress = 1,
  className,
  playedColor = "bg-accent-blue",
  remainingColor = "bg-slate-200",
  animate = false,
}: {
  bars?: number;
  height?: number;
  progress?: number;
  className?: string;
  playedColor?: string;
  remainingColor?: string;
  animate?: boolean;
}) {
  return (
    <div
      className={cn("flex items-center gap-[2px]", className)}
      style={{ height }}
      aria-hidden
    >
      {Array.from({ length: bars }, (_, i) => {
        const amplitude = PATTERN[i % PATTERN.length];
        const played = i / bars < progress;
        return (
          <span
            key={i}
            className={cn(
              "w-[2.5px] shrink-0 rounded-full",
              played ? playedColor : remainingColor,
              // Staggered so the bars ripple rather than pulsing in unison.
              animate && "origin-center animate-wave",
            )}
            style={{
              height: `${Math.round(amplitude * height)}px`,
              animationDelay: animate ? `${(i % 8) * 90}ms` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
