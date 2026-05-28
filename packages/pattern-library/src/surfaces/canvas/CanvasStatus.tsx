import Box from '@ux/box';
import text from '@ux/text';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';

import { ThinkingIndicator } from '../../primitives/thinking-indicator';

/**
 * Props for `Canvas.Status`.
 */
export interface CanvasStatusProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Visible label inside the chip — the user-facing description of the
   * current status. e.g. `"Editing…"`, `"Generating preview…"`.
   *
   * Use a string when possible so the rendered label doubles as the
   * accessible name read by screen readers; pass `aria-label` explicitly
   * when `label` is a non-string node.
   */
  label: ReactNode;
}

/**
 * Floating status pill — typically anchored over a `Canvas` (via the
 * `status` slot) to signal an in-progress agent action without blocking the
 * underlying preview.
 *
 * The chip is a `role="status"` live region so screen readers announce label
 * changes politely as the status transitions through phases ("Editing…" →
 * "Saving…" → "Done"). The inner spinner is `aria-hidden`, so the announced
 * text is exactly the visible label and never doubles up.
 *
 * The component renders no positioning by itself — it is a flow-level pill.
 * When passed as `Canvas`'s `status` prop, the canvas anchors it top-center
 * over the content area; consumers that need viewport-anchored or portaled
 * placement should wrap `Canvas.Status` in their own positioned element.
 *
 * @example Inside a `Canvas`
 * ```tsx
 * <Canvas status={<Canvas.Status label="Editing…" />}>
 *   <SitePreview />
 * </Canvas>
 * ```
 *
 * @example Standalone (consumer positions)
 * ```tsx
 * <div style={{ position: 'fixed', top: 16, insetInlineStart: '50%' }}>
 *   <Canvas.Status label="Saving draft" />
 * </div>
 * ```
 */
export const CanvasStatus = forwardRef<HTMLDivElement, CanvasStatusProps>(function CanvasStatus(
  { label, className, ...rest },
  ref,
) {
  // Compute the accessible name for the live region. Order of precedence:
  //   1. consumer-passed `aria-label` (escape hatch / non-string label),
  //   2. the string form of `label` (the common case — visible text doubles
  //      as accessible name),
  //   3. nothing (when `label` is a non-string node and the consumer did not
  //      pass `aria-label`, the chip falls back to text-content naming).
  // Setting `aria-label` explicitly avoids edge cases where the inner
  // aria-hidden indicator wins the accessible-name calculation against the
  // outer live region.
  const { 'aria-label': consumerAriaLabel, ...restProps } = rest;
  const ariaLabel =
    consumerAriaLabel !== undefined
      ? consumerAriaLabel
      : typeof label === 'string'
        ? label
        : undefined;
  return (
    <Box
      {...restProps}
      ref={ref}
      role="status"
      aria-label={ariaLabel}
      // `componentAiro` swaps the chip's intent palette to the Airo-purple
      // partial — `box.backgroundColor` / `box.foregroundColor` /
      // `feedbackHighContrastHighlight.feedbackColor` (used by the inner
      // spinner) all flip together so the chip reads as a single Airo
      // surface rather than a neutral pill.
      data-partial="componentAiro"
      className={classnames('airo-surfaces-canvas-status', className)}
      // Layout — Box owns inline-flex / horizontal / center alignment / SM
      // padding both axes / SM gap, so the chip's stylesheet only carries
      // the chrome (border, radius, background, shadow).
      displayType="inline-flex"
      orientation="horizontal"
      blockAlignChildren="center"
      inlinePadding="sm"
      blockPadding="sm"
      gap="sm"
    >
      <ThinkingIndicator
        variant="spinner"
        // The chip's outer `role="status"` already announces the label, so
        // suppress the indicator's own live-region announcement to avoid
        // double-reads on mount.
        aria-hidden="true"
        // Empty string keeps the indicator's accessible name out of the
        // accessibility tree entirely (paired with aria-hidden).
        label=""
        className="airo-surfaces-canvas-status__indicator"
      />
      {/* `<text.span as="label">` gives the chip the UXCore label-size
          typography (size, weight, leading) instead of hand-rolled
          font-size declarations. */}
      <text.span as="label" className="airo-surfaces-canvas-status__label">
        {label}
      </text.span>
    </Box>
  );
});
