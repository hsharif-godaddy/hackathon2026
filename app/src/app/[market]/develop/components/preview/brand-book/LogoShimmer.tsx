'use client';

import { type CSSProperties,useId, useMemo } from 'react';
import { buildLogoShimmerBackdropSvg, buildLogoShimmerSvg, type ShimmerOrientation } from '@airo/shared/logo-shimmer';

/**
 * Animated logo placeholder shown while an async logo job is in flight
 * (i.e. a media slot has `pendingJobId` set).
 *
 * Two modes (see SHARED CONTRACT for the regeneration-vs-fresh distinction):
 *
 * - `skeleton` (default): the shared "liquid ink + self-drawing bloom" placeholder
 *   used when the slot had NO prior real logo (fresh generation). It renders the SAME
 *   SVG that the agents service writes into the customer app, so the builder preview
 *   and the live app match exactly. The slot's `currentUrl` points at an /airo-assets/*
 *   shimmer placeholder that does NOT resolve on the builder origin, so callers render
 *   this instead of loading that URL.
 *
 * - `overlay` (LogoShimmerOverlay): an absolutely-positioned, translucent layer that sits ON TOP
 *   of a dimmed copy of the user's EXISTING logo during a regeneration. It reuses the skeleton's
 *   drifting-colour-blob backdrop (WITHOUT the bloom mark / wordmark) as a soft moving aurora —
 *   consistent with the skeleton and free of the hard-edged sweep the old sheen had. The caller
 *   owns the `relative` container and renders the dimmed <img> beneath; the overlay is
 *   `pointer-events:none` so it never intercepts clicks.
 *
 * Both SVGs honour `prefers-reduced-motion` internally (motion stops, state held). The bloom SVG
 * is orientation-aware (square / horizontal / vertical) so the placeholder matches the slot shape.
 */

/** Map a logo slot name/path (e.g. "logo/horizontal") to a shimmer orientation. */
export function logoShimmerOrientation(slotName?: string | null): ShimmerOrientation {
  if (!slotName) return 'square';
  if (slotName.includes('horizontal')) return 'horizontal';
  if (slotName.includes('vertical')) return 'vertical';
  return 'square';
}

/**
 * Wall-clock phase for the skeleton animation. PreviewPane mounts BrandBookView in
 * two mutually-exclusive branches (pre-server-ready vs. ready overlay), so React
 * re-mounts the whole subtree — and the shimmer's CSS animation — whenever the
 * preview server's readiness flips during generation. Anchoring the animation to a
 * lazily-set session epoch and feeding the elapsed time as a negative
 * `animation-delay` makes a re-mount resume mid-loop instead of restarting from 0.
 */
let shimmerEpoch: number | null = null;
function shimmerElapsedMs(): number {
  if (typeof performance === 'undefined') return 0;
  if (shimmerEpoch === null) shimmerEpoch = performance.now();
  return Math.max(0, performance.now() - shimmerEpoch);
}

// Overlay opacity. `normal` blend (no mix-blend-mode) is the only choice that reads on BOTH
// light and dark logo panels — `screen`/`plus-lighter` glow on dark but vanish on white.
const OVERLAY_OPACITY = 0.65;

export interface LogoShimmerProps {
  /** Sizing/positioning classes (e.g. "w-full h-full", "aspect-square w-full"). */
  className?: string;
  /** Escape hatch for inline sizing when a Tailwind class is not convenient. */
  style?: CSSProperties;
  /** Accessible label for assistive tech; defaults to a generic generating message. */
  ariaLabel?: string;
  /**
   * `skeleton` (default) — the self-drawing bloom placeholder for fresh generation.
   * `overlay` — translucent sheen layered over an existing (dimmed) logo during regeneration.
   */
  mode?: 'skeleton' | 'overlay';
  /** Bloom lockup orientation (skeleton mode only). Default 'square'. */
  orientation?: ShimmerOrientation;
  /** Forwarded test id. */
  'data-testid'?: string;
}

export function LogoShimmer({
  className = '',
  style,
  ariaLabel = 'Generating logo',
  mode = 'skeleton',
  orientation = 'square',
  'data-testid': dataTestId = 'logo-shimmer',
}: LogoShimmerProps) {
  // DOM-safe unique prefix so multiple inlined SVGs don't share ids/keyframes.
  const rawId = useId();
  const prefix = useMemo(() => `s${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);
  const isOverlay = mode === 'overlay';
  // elapsedMs is read once per mount (memo only re-runs on its deps) so a re-mount
  // resumes the loop at its current wall-clock phase instead of restarting.
  const svg = useMemo(
    () =>
      isOverlay
        ? buildLogoShimmerBackdropSvg(prefix, { elapsedMs: shimmerElapsedMs() })
        : buildLogoShimmerSvg(orientation, prefix, { decorative: true, elapsedMs: shimmerElapsedMs() }),
    [isOverlay, orientation, prefix],
  );

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      data-testid={dataTestId}
      data-logo-shimmer={isOverlay ? 'overlay' : 'skeleton'}
      style={
        isOverlay
          ? { position: 'absolute', inset: 0, pointerEvents: 'none', opacity: OVERLAY_OPACITY, lineHeight: 0, ...style }
          : { lineHeight: 0, ...style }
      }
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Convenience wrapper for layering the soft drifting-blob aurora over an existing (dimmed) logo
 * during a regeneration. The caller must place this inside a `relative`-positioned container that
 * also holds the dimmed <img>; this layer is absolutely positioned and `pointer-events:none`.
 */
export function LogoShimmerOverlay({
  className = '',
  style,
  ariaLabel = 'Updating logo',
  'data-testid': dataTestId = 'logo-shimmer-overlay',
}: Omit<LogoShimmerProps, 'mode' | 'orientation'>) {
  return (
    <LogoShimmer
      mode="overlay"
      className={className}
      style={style}
      ariaLabel={ariaLabel}
      data-testid={dataTestId}
    />
  );
}

export default LogoShimmer;
