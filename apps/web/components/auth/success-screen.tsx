import { Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { GradientButton } from "@/components/auth/auth-ui";

/**
 * The confirmation screen, shared by "Password Reset Successful" and "Welcome" — the two
 * points in the flow that end a journey rather than continue one. One component because
 * they are the same screen with different words, and a tick that lands two pixels apart
 * between them would be noticed.
 */
export function SuccessScreen({
  title,
  body,
  action,
  href,
}: {
  title: string;
  body: string;
  action: string;
  href: string;
}) {
  return (
    <div className="relative w-full max-w-[440px] overflow-hidden rounded-card border border-slate-200/70 bg-surface p-6 text-center shadow-card sm:p-8">
      <div className="flex justify-center">
        <Logo size="md" />
      </div>

      <div className="relative mt-8 flex justify-center">
        <Confetti />
        <span className="relative flex h-[88px] w-[88px] items-center justify-center rounded-full bg-brand-green/[0.13]">
          <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-brand-green">
            <Check className="h-8 w-8 text-white" strokeWidth={3.2} />
          </span>
        </span>
      </div>

      <h1 className="mt-7 text-[23px] font-bold tracking-tight text-brand-navy">{title}</h1>
      <p className="mx-auto mt-2 max-w-[320px] text-[13.5px] leading-relaxed text-slate-500">
        {body}
      </p>

      <div className="mt-7">
        <GradientButton href={href}>{action}</GradientButton>
      </div>
    </div>
  );
}

/**
 * The scatter around the tick. Positions are a fixed list rather than random, for the
 * same reason the waveform's are: a server render and a client hydration have to agree,
 * and confetti that reshuffles on every re-render reads as a glitch.
 */
const PIECES: { x: number; y: number; r: number; c: string; w: number; h: number }[] = [
  { x: 8, y: 30, r: -20, c: "#F7671E", w: 7, h: 7 },
  { x: 26, y: 6, r: 25, c: "#E5199B", w: 6, h: 10 },
  { x: 52, y: 20, r: -10, c: "#237DF5", w: 5, h: 5 },
  { x: 74, y: 2, r: 40, c: "#19B969", w: 7, h: 7 },
  { x: 96, y: 26, r: -35, c: "#9333EA", w: 6, h: 9 },
  { x: 118, y: 8, r: 15, c: "#F5A623", w: 6, h: 6 },
  { x: 140, y: 34, r: -25, c: "#E5199B", w: 5, h: 9 },
  { x: 2, y: 74, r: 30, c: "#237DF5", w: 6, h: 6 },
  { x: 22, y: 96, r: -15, c: "#19B969", w: 5, h: 8 },
  { x: 128, y: 88, r: 20, c: "#F7671E", w: 6, h: 6 },
  { x: 146, y: 68, r: -40, c: "#9333EA", w: 5, h: 8 },
  { x: 62, y: 104, r: 10, c: "#F5A623", w: 7, h: 5 },
];

function Confetti() {
  return (
    <svg
      className="pointer-events-none absolute -top-3 left-1/2 h-[126px] w-[164px] -translate-x-1/2"
      viewBox="0 0 164 126"
      fill="none"
      aria-hidden
    >
      {PIECES.map((piece, index) => (
        <rect
          key={index}
          x={piece.x}
          y={piece.y}
          width={piece.w}
          height={piece.h}
          rx={1.5}
          fill={piece.c}
          transform={`rotate(${piece.r} ${piece.x + piece.w / 2} ${piece.y + piece.h / 2})`}
        />
      ))}
    </svg>
  );
}
