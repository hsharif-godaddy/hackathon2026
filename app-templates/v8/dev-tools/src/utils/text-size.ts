// Tailwind text-size scale, ordered small → large.
export const SIZE_SCALE = [
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "text-3xl",
  "text-4xl",
  "text-5xl",
  "text-6xl",
  "text-7xl",
  "text-8xl",
  "text-9xl",
] as const;

export type SizeClass = (typeof SIZE_SCALE)[number];

// Tailwind default size scale in rem. Themes may override these in CSS, but
// in the absence of a theme override the rem mapping holds. Used by
// nearestSizeClass to map a computed pixel font-size back onto the scale.
const SIZE_REM: Record<SizeClass, number> = {
  "text-xs": 0.75,
  "text-sm": 0.875,
  "text-base": 1,
  "text-lg": 1.125,
  "text-xl": 1.25,
  "text-2xl": 1.5,
  "text-3xl": 1.875,
  "text-4xl": 2.25,
  "text-5xl": 3,
  "text-6xl": 3.75,
  "text-7xl": 4.5,
  "text-8xl": 6,
  "text-9xl": 8,
};

// Default upper bound for the stepper. text-7xl..text-9xl (4.5rem..8rem)
// regularly overflow section heights on a typical heading, so by default the
// stepper refuses to step UP past text-6xl. The cap is shifted dynamically
// when the element ALREADY starts above it (see nextSize below) — some
// headings legitimately ship at text-7xl+ and locking those users out of
// stepping at all is worse than the layout-overflow risk.
const DEFAULT_MAX_INDEX = SIZE_SCALE.indexOf("text-6xl");
const MIN_STEPPABLE_INDEX = 0;

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

interface NextSizeOptions {
  /** DOM tagName of the target element (case-insensitive). When the tag is
   *  a heading (h1-h6), the upper cap shifts to the top of the scale —
   *  headings frequently want large sizes and the default text-6xl cap was
   *  locking users out of stepping back up. Body text (p, span, div, …)
   *  keeps the conservative cap to prevent accidental section overflow. */
  tagName?: string;
}

/**
 * Compute the next size class to apply when the user clicks +/−. Returns
 * `null` when the requested step is not allowed (already at the floor going
 * down, at the effective cap going up).
 *
 * Effective upper cap is determined by:
 *   1. Heading tag (h1-h6) → text-9xl (full scale)
 *   2. Element already above text-6xl → text-9xl (intentional oversize stays editable)
 *   3. Otherwise → text-6xl (default body-text cap)
 */
export function nextSize(
  current: SizeClass,
  direction: "up" | "down",
  options: NextSizeOptions = {},
): SizeClass | null {
  const idx = SIZE_SCALE.indexOf(current);
  if (idx === -1) return null;
  if (direction === "up") {
    const isHeading = !!options.tagName && HEADING_TAGS.has(options.tagName.toLowerCase());
    const effectiveMax =
      isHeading || idx > DEFAULT_MAX_INDEX ? SIZE_SCALE.length - 1 : DEFAULT_MAX_INDEX;
    if (idx >= effectiveMax) return null;
    return SIZE_SCALE[idx + 1];
  }
  if (idx <= MIN_STEPPABLE_INDEX) return null;
  return SIZE_SCALE[idx - 1];
}

/**
 * Map a computed pixel font-size to the closest Tailwind text-{size} class.
 * Used as the source of truth for "what size does the user see on this
 * element" — handles responsive variants at the current breakpoint, theme
 * overrides, and inherited sizes that classList scanning misses.
 *
 * Defaults to a 16px root (the browser default). Pass a different rootPx
 * when the document's html element has a custom font-size.
 */
export function nearestSizeClass(pxFontSize: number, rootPx = 16): SizeClass {
  let best: SizeClass = SIZE_SCALE[0];
  let bestDiff = Infinity;
  for (const cls of SIZE_SCALE) {
    const px = SIZE_REM[cls] * rootPx;
    const diff = Math.abs(px - pxFontSize);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cls;
    }
  }
  return best;
}
