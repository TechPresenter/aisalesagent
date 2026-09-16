import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  className?: string;
  width?: number;
  height?: number;
  color?: string;
}

/**
 * Hand-rolled rather than a Recharts instance: five of these mount on first paint, and a
 * decorative 60x24 trend line does not need an axis system, a tooltip layer or a resize
 * observer behind it. The real charts still use Recharts, per the TRD stack.
 */
export function Sparkline({
  data,
  className,
  width = 64,
  height = 26,
  color = "#237DF5",
}: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  // A flat series would divide by zero; pin it to the vertical middle instead.
  const span = max - min || 1;
  const stepX = width / (data.length - 1);

  const points = data.map((value, i) => {
    const x = i * stepX;
    const y = height - ((value - min) / span) * (height - 2) - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0 overflow-visible", className)}
    >
      <polyline
        points={points.join(" ")}
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
