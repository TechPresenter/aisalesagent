import { TONE_HEX } from "@/lib/status";
import type { FunnelStage } from "@/lib/mock-analytics";
import { formatNumber } from "@/lib/utils";

/**
 * The lead-status funnel.
 *
 * Drawn as SVG trapezoids rather than a chart library: the shape is five stacked bands
 * whose widths are a straight proportion of the first stage, which is a handful of
 * coordinates — pulling in a funnel plugin to draw it would be more code, not less, and
 * one more dependency between the palette and the screen.
 *
 * The width is deliberately proportional to the *value*, not the rank. A funnel whose
 * bands taper by a fixed amount looks tidier and lies: it would draw the same picture
 * whether 128 of 254 leads were contacted or 12 were.
 */
export function LeadFunnel({ stages }: { stages: FunnelStage[] }) {
  const width = 240;
  const bandHeight = 42;
  const gap = 3;
  const height = stages.length * (bandHeight + gap) - gap;
  const max = stages[0]?.value || 1;

  // Never narrower than this, or the last band becomes a sliver with a number over it.
  const minWidthRatio = 0.28;

  const widthFor = (value: number) =>
    width * (minWidthRatio + (1 - minWidthRatio) * (value / max));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={stages
        .map((stage) => `${stage.label}: ${formatNumber(stage.value)}`)
        .join(", ")}
      className="max-w-[240px]"
    >
      {stages.map((stage, index) => {
        const top = widthFor(stage.value);
        // Taper towards the next stage's width so the bands read as one continuous
        // funnel rather than five unrelated bars.
        const bottom = widthFor(stages[index + 1]?.value ?? stage.value * 0.82);
        const y = index * (bandHeight + gap);

        const topLeft = (width - top) / 2;
        const bottomLeft = (width - bottom) / 2;

        return (
          <g key={stage.label}>
            <path
              d={`M${topLeft} ${y} H${topLeft + top} L${bottomLeft + bottom} ${y + bandHeight} H${bottomLeft} Z`}
              fill={TONE_HEX[stage.tone]}
            />
            <text
              x={width / 2}
              y={y + bandHeight / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#FFFFFF"
              fontSize="15"
              fontWeight="700"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatNumber(stage.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
