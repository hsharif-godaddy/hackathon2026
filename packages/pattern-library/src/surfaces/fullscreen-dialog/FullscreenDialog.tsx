import Disrupt from '@ux/disrupt';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, useCallback, useState } from 'react';

import { PanelChrome, type PanelChromeProps } from '../panel-chrome';

// ─── Props ────────────────────────────────────────────────────────────────

/**
 * Base props for `FullscreenDialog` — everything except the accessible-name
 * fields enforced via {@link FullscreenDialogLabelProps}.
 */
interface FullscreenDialogBaseProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'aria-label' | 'aria-labelledby'> {
  // ── Visibility (controlled + uncontrolled) ────────────────────────────
  /**
   * Whether the dialog is visible. Controlled. Pair with `onClose`.
   */
  show?: boolean;
  /**
   * Initial visibility when uncontrolled.
   * @default false
   */
  defaultShow?: boolean;
  /**
   * Fires when the user dismisses the dialog — Escape key (handled by
   * `@ux/disrupt`'s focus lock), the scrim backdrop, or the default
   * corner-action close button.
   */
  onClose?: () => void;

  // ── PanelChrome passthrough ────────────────────────────────────────────
  /**
   * Title — string is the simplest way to satisfy the accessible-name
   * requirement.
   */
  title?: ReactNode;
  /**
   * Corner actions slot. Pass `null` to hide; pass a node to replace.
   */
  cornerActions?: ReactNode;
  /**
   * Accessible label for the default close button.
   * @default "Close"
   */
  closeLabel?: string;
  /**
   * Accessible label for the default expand button.
   * @default "Expand"
   */
  expandLabel?: string;
  /**
   * Accessible label for the default collapse button.
   * @default "Collapse"
   */
  collapseLabel?: string;
  /**
   * Header slot. Pass `null` to omit; pass a node to replace.
   */
  header?: ReactNode;
  /**
   * Hide-on-scroll-down / reveal-on-scroll-up behavior for the header.
   * @default true
   */
  stickyHeader?: boolean;
  /**
   * Scrollable body content.
   */
  children?: ReactNode;
  /**
   * Footer slot. Sticky to the trailing edge; slides in when shown.
   */
  footer?: ReactNode;
  /**
   * Explicitly hide the footer.
   */
  hideFooter?: boolean;
  /**
   * Footer band treatment inside `PanelChrome`. Forwarded unchanged.
   *
   * - **`default`** — solid footer band, shadow, padded inner `Box`.
   * - **`floating`** — transparent band, no footer shadow; use with **`FloatingFooter`**
   *   + borderless composers (see **Examples / Fullscreen Chat Dialog → Full chat layout
   *   (floating composer)**).
   *
   * @default 'default'
   */
  footerChrome?: 'default' | 'floating';

  // ── Portal ────────────────────────────────────────────────────────────
  /**
   * Target element for the `@ux/disrupt` portal. Defaults to
   * `document.body`.
   */
  portalElem?: Element;
}

/**
 * Enforces that every `FullscreenDialog` carries an accessible name. At least
 * one of the three branches must be satisfied:
 *
 * - **`title: string`** — simplest.
 * - **`aria-label: string`** — use when `title` is non-string or when a
 *   custom `header` is supplied and no element id is available.
 * - **`aria-labelledby: string`** — use when a custom `header` renders its
 *   own labelling element and you can supply its id.
 */
type FullscreenDialogLabelProps =
  | { title: string; 'aria-label'?: string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label': string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label'?: string; 'aria-labelledby': string };

/**
 * Props for `FullscreenDialog`.
 *
 * **Accessible name requirement** — the dialog renders as `role="dialog"` +
 * `aria-modal="true"`. Satisfy the accessible name with one of: a string
 * `title`, an `aria-label`, or an `aria-labelledby`.
 */
export type FullscreenDialogProps = FullscreenDialogBaseProps & FullscreenDialogLabelProps;

// ─── Component ────────────────────────────────────────────────────────────

/**
 * `FullscreenDialog` is a full-viewport modal surface built on `@ux/disrupt`.
 * It provides a scrim, focus trap, Escape-to-close, and a React portal —
 * the same infrastructure as `Panel`'s modal path. Inner UI (header,
 * scrollable content, sticky footer) is provided by `PanelChrome`.
 *
 * The dialog always covers the entire viewport — edge-to-edge, no margins,
 * no border-radius. Chat state and open/close state live in the consumer;
 * this component is a presentational surface.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * <FullscreenDialog
 *   show={open}
 *   onClose={() => setOpen(false)}
 *   title="Airo"
 *   footer={<Button design="primary" text="Done" />}
 * >
 *   <Box inlinePadding="lg"><p>Content</p></Box>
 * </FullscreenDialog>
 * ```
 *
 * @see {@link FullscreenDialogProps} for the full prop reference.
 */
export function FullscreenDialog({
  show: showProp,
  defaultShow = false,
  onClose,
  portalElem,
  className,
  ...rest
}: FullscreenDialogProps) {
  // ── Show state ────────────────────────────────────────────────────────
  const [internalShow, setInternalShow] = useState(defaultShow);
  const isControlled = showProp !== undefined;
  const isOpen = isControlled ? showProp : internalShow;

  const handleClose = useCallback(() => {
    if (!isControlled) setInternalShow(false);
    onClose?.();
  }, [isControlled, onClose]);

  // ── Portal target ─────────────────────────────────────────────────────
  // Resolve synchronously so Disrupt receives a stable portal target on the
  // first open render — avoids an extra re-render that would re-parent the
  // portal and re-trigger focus-lock. Guards `document` for SSR safety.
  const target = portalElem ?? (typeof document !== 'undefined' ? document.body : undefined);

  if (!isOpen) return null;

  const chromeProps: PanelChromeProps = {
    ...(rest as PanelChromeProps),
    onClose: handleClose,
    modal: true, // Disrupt owns focus-trap + Escape + focus-restore
    className: classnames('airo-surfaces-fullscreen-dialog__chrome', className),
  };

  return (
    <Disrupt
      className="airo-surfaces-fullscreen-dialog"
      strategy="fixed"
      portalElem={target}
      focusLock={{ autoFocus: false, returnFocus: true, disabled: false }}
      onClose={handleClose}
      fullScreenChildren
    >
      <PanelChrome {...chromeProps} />
    </Disrupt>
  );
}
