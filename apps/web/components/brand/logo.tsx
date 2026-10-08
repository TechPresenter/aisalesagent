import Image from "next/image";
import { appBrand } from "@/config/app-brand";
import { cn } from "@/lib/utils";
import logoArtwork from "@/public/brand/appsgain-logo.png";
import logoArtworkOnDark from "@/public/brand/appsgain-logo-white.png";
import markArtwork from "@/public/brand/appsgain-mark.png";

/**
 * The Appsgain lockup: the gradient "ag" monogram, a hairline rule, then the stacked
 * wordmark with its tagline — the supplied artwork in `public/brand/`.
 *
 * `appsgain-logo-white.png` is the same artwork with the black lettering turned white, for
 * the navy sidebar; the gradient mark and rules are unchanged. The favicon
 * (`app/icon.png`, `app/apple-icon.png`) is the monogram cut from the same file. Every
 * screen reads this one component, so replacing the PNGs is all a new logo needs.
 */

/** Rendered height in px; the width follows from the artwork's aspect ratio. */
const HEIGHTS = { sm: 38, md: 48, lg: 58 } as const;

export type LogoSize = keyof typeof HEIGHTS;

export function Logo({
  size = "md",
  onDark = false,
  className,
}: {
  size?: LogoSize;
  /** Switches to the white wordmark for the navy sidebar; the mark keeps its gradient. */
  onDark?: boolean;
  className?: string;
}) {
  const height = HEIGHTS[size];
  const artwork = onDark ? logoArtworkOnDark : logoArtwork;

  return (
    <Image
      src={artwork}
      alt={appBrand.name}
      height={height}
      width={Math.round((artwork.width / artwork.height) * height)}
      priority
      className={cn("shrink-0 select-none", className)}
    />
  );
}

/** The "ag" monogram on its own — for anywhere the full lockup would not fit. */
export function Mark({ size = 38, className }: { size?: number; className?: string }) {
  return (
    <Image
      src={markArtwork}
      alt={appBrand.name}
      height={size}
      width={Math.round((markArtwork.width / markArtwork.height) * size)}
      className={cn("shrink-0 select-none", className)}
    />
  );
}
