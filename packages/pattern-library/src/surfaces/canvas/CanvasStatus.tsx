import Box from '@ux/box';
import text from '@ux/text';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';

import { ThinkingIndicator } from '../../primitives/thinking-indicator';

interface CanvasStatusBodyProps {
  label: ReactNode;
}

function CanvasStatusBody({ label }: CanvasStatusBodyProps) {
  return (
    <>
      <ThinkingIndicator
        variant="spinner"
        aria-hidden="true"
        label=""
        className="airo-surfaces-canvas-status__indicator"
      />
      <text.span as="label" size={-1} className="airo-surfaces-canvas-status__label">
        {label}
      </text.span>
    </>
  );
}

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
 * Width follows content + padding (no JS measurement).
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
      elevation="overlay"
      // Layout — Box owns inline-flex / horizontal / center alignment and
      // overlay elevation; padding and gap are pinned in styles.css.
      displayType="inline-flex"
      orientation="horizontal"
      blockAlignChildren="center"
    >
      <CanvasStatusBody label={label} />
    </Box>
  );
});
