import * as React from "react";
import { cn } from "@/lib/utils";
import { TONE_BADGE, type Tone } from "@/lib/status";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/** Brand Guidelines §5: pill, 12–15% tint background, solid colour as the text. */
export function Badge({ className, tone = "gray", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold leading-none",
        TONE_BADGE[tone],
        className,
      )}
      {...props}
    />
  );
}
