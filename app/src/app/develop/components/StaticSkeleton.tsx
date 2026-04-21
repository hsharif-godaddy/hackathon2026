interface StaticSkeletonProps {
  width: string;
  height: string;
  rounding?: 'full';
  className?: string;
}

/**
 * Lightweight CSS-only skeleton placeholder — no JS animation overhead.
 * Reuses the `ux-skeleton` class for visual consistency with `@ux/skeleton`.
 */
export default function StaticSkeleton({ width, height, rounding, className }: StaticSkeletonProps) {
  return (
    <div
      className={`ux-skeleton bg-intents-ux-boxLowContrast-backgroundColor ${rounding === 'full' ? 'rounded-full' : 'rounded-sm'} ${className ?? ''}`.trim()}
      style={{ width, height }}
    />
  );
}
