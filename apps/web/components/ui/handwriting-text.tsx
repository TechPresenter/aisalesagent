"use client";

import { useEffect, useState } from "react";

/**
 * Text that writes itself left to right, then inks in. CSS only: no font download, no
 * script, nothing fetched from another origin.
 *
 * It used to trace real glyph outlines: opentype.js injected from a CDN parsed a
 * handwriting font from a second CDN, and each contour was stroked as an SVG path. In
 * production the font request was blocked by CORS, so every dashboard load paid for a
 * 171 KB script that rendered plain text anyway, from a third party, without integrity
 * checking. This version keeps the effect and drops all of that:
 *
 * 1. An outline copy of the word — transparent fill, `-webkit-text-stroke` in the text
 *    colour — is uncovered by a `clip-path` inset that slides from the left edge to the
 *    right, so the word appears the way a pen crosses it.
 *
 * 2. A filled copy in the same grid cell fades in as the pen finishes, which gives the
 *    weight. With `fill={false}` only the outline is left.
 *
 * Both copies are hidden from assistive technology; one plain-text copy is read instead,
 * so a screen reader hears the word once rather than twice.
 *
 * With reduced motion requested the word is shown inked at once and does not rotate.
 * Colour comes from `currentColor`, so `className="text-emerald-600"` styles it, and size
 * from the surrounding font size.
 */

export interface HandwritingTextProps {
  /** A single phrase to write. Ignored when `words` is given. */
  text?: string;
  /** Cycle through these, rewriting on each change. */
  words?: string[];
  /** Milliseconds each word is held before the next one starts. */
  interval?: number;
  /** Seconds for the pen to cross the whole word. */
  duration?: number;
  /** Seconds before the pen starts. */
  delay?: number;
  /** Outline weight, in hundredths of the font size. */
  strokeWidth?: number;
  /** Ink the letters in once drawn. Set false to leave them as outlines. */
  fill?: boolean;
  className?: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function HandwritingText({
  text,
  words,
  interval = 3200,
  duration = 1.5,
  delay = 0.05,
  strokeWidth = 1.6,
  fill = true,
  className,
}: HandwritingTextProps) {
  const cycle = Boolean(words && words.length > 1);
  const [index, setIndex] = useState(0);
  const [still, setStill] = useState(false);
  const current = words && words.length > 0 ? words[index % words.length] : (text ?? "");

  useEffect(() => {
    setStill(prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!cycle || still) return undefined;
    const id = setInterval(() => setIndex((i) => i + 1), interval);
    return () => clearInterval(id);
  }, [cycle, still, interval]);

  return (
    <span className={["inline-block whitespace-nowrap", className].filter(Boolean).join(" ")}>
      <span className="sr-only">{current}</span>
      {/* Keyed on the word, so each new word starts a fresh pen stroke. */}
      <Stroke
        key={`${index}:${current}`}
        word={current}
        duration={duration}
        delay={delay}
        strokeWidth={strokeWidth}
        fill={fill}
        still={still}
      />
    </span>
  );
}

function Stroke({
  word,
  duration,
  delay,
  strokeWidth,
  fill,
  still,
}: {
  word: string;
  duration: number;
  delay: number;
  strokeWidth: number;
  fill: boolean;
  still: boolean;
}) {
  const [drawn, setDrawn] = useState(still);

  useEffect(() => {
    if (still) {
      setDrawn(true);
      return undefined;
    }
    // Two frames: the first commits the hidden state with no transition, the second
    // enables it and moves to the drawn state. Both in one commit leaves nothing to
    // animate.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    // rAF does not fire in a backgrounded tab or an offscreen renderer, and the word
    // starts clipped out of sight — so without a floor it would never appear at all, which
    // is a worse failure than not animating.
    const floor = setTimeout(() => setDrawn(true), 200);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(floor);
    };
  }, [still]);

  const animate = drawn && !still;
  const layer = "col-start-1 row-start-1";

  return (
    <span aria-hidden className="inline-grid">
      <span
        className={layer}
        style={{
          color: "inherit",
          WebkitTextFillColor: "transparent",
          // Floored at under a pixel so the outline still shows at body-text sizes.
          WebkitTextStroke: `max(0.75px, ${(strokeWidth / 100).toFixed(4)}em) currentColor`,
          clipPath: drawn ? "inset(-20% -5% -20% -5%)" : "inset(-20% 105% -20% -5%)",
          transition: animate
            ? `clip-path ${duration.toFixed(3)}s cubic-bezier(0.45, 0.05, 0.35, 1) ${delay.toFixed(3)}s`
            : "none",
        }}
      >
        {word}
      </span>
      {fill && (
        <span
          className={layer}
          style={{
            opacity: drawn ? 1 : 0,
            transition: animate
              ? `opacity 0.45s ease-out ${(delay + duration * 0.72).toFixed(3)}s`
              : "none",
          }}
        >
          {word}
        </span>
      )}
    </span>
  );
}

export default HandwritingText;
