import Button from '@ux/button';
import CornerActions from '@ux/corner-actions';
import Disrupt from '@ux/disrupt';
import AsyncIcon from '@ux/icon/async-icon.js';
import TextLockup from '@ux/text-lockup';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, useCallback, useEffect, useId, useState } from 'react';

import { DragHandle } from '../../primitives/drag-handle';

// ─── Props ────────────────────────────────────────────────────────────────

/**
 * Base props for `BottomSheet` — everything except the accessible-name fields,
 * which are enforced separately via {@link BottomSheetLabelProps}.
 */
interface BottomSheetBaseProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'aria-label' | 'aria-labelledby'> {
  /**
   * Whether the sheet is visible. Controlled. Pair with `onClose`.
   */
  show?: boolean;
  /**
   * Initial visibility when uncontrolled.
   * @default false
   */
  defaultShow?: boolean;
  /**
   * Fires when the user dismisses the sheet — the header dismiss (X) button,
   * a tap on the scrim backdrop, or the Escape key (wired at the document
   * level so it works regardless of focus; see the effect in the component).
   */
  onClose?: () => void;
  /**
   * Optional heading rendered at the top of the sheet, below the drag handle.
   * A **string** title is the simplest way to satisfy the accessible-name
   * requirement; it is wired to `aria-labelledby`. Non-string nodes are
   * accepted for display but do not produce an accessible name on their own —
   * supply `aria-label` or `aria-labelledby` when `title` is not a string.
   */
  title?: ReactNode;
  /**
   * Accessible label for the header's dismiss (X) button.
   * @default 'Close'
   */
  closeLabel?: string;
  /**
   * Show the header dismiss (X) button.
   *
   * Set to `false` for a chromeless sheet dismissed by tapping the scrim or
   * pressing Escape (e.g. a command palette). When `false` and no `title` is
   * given, the header is omitted entirely — leaving only the decorative drag
   * handle, which signals dismissibility but is not itself interactive.
   * @default true
   */
  showCloseButton?: boolean;
  /**
   * Scrollable body content.
   */
  children?: ReactNode;
  /**
   * Target element for the `@ux/disrupt` portal.
   * @default document.body
   */
  portalElem?: Element;
}

/**
 * Enforces that every `BottomSheet` carries an accessible name. At least one
 * of the three branches must be satisfied:
 *
 * - **`title: string`** — simplest; wired to `aria-labelledby`.
 * - **`aria-label: string`** — use when `title` is non-string / omitted.
 * - **`aria-labelledby: string`** — point at an element you render in `children`.
 */
type BottomSheetLabelProps =
  | { title: string; 'aria-label'?: string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label': string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label'?: string; 'aria-labelledby': string };

/**
 * Props for `BottomSheet`.
 *
 * **Accessible name requirement** — the sheet renders as `role="dialog"` +
 * `aria-modal="true"`. Satisfy the accessible name with one of: a string
 * `title`, an `aria-label`, or an `aria-labelledby`.
 */
export type BottomSheetProps = BottomSheetBaseProps & BottomSheetLabelProps;

// ─── Component ────────────────────────────────────────────────────────────

/**
 * `BottomSheet` is a mobile overlay surface built on `@ux/disrupt`. It slides
 * up from the viewport's bottom edge, fades in a scrim behind it, traps focus,
 * and closes on Escape or scrim tap — the same Disrupt recipe as `Panel`, but
 * sliding on the Y axis with rounded top corners and a grab-handle affordance.
 *
 * It is a presentational surface: open/close state and body content live in the
 * consumer. Use it as the mobile rendering of menus and action lists (see
 * `ResponsiveMenu`), or directly for any bottom-anchored sheet content.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * <BottomSheet show={open} onClose={() => setOpen(false)} title="Actions">
 *   <button type="button" onClick={...}>Rename</button>
 *   <button type="button" onClick={...}>Delete</button>
 * </BottomSheet>
 * ```
 *
 * @see {@link BottomSheetProps} for the full prop reference.
 */
export function BottomSheet({
  show: showProp,
  defaultShow = false,
  onClose,
  title,
  closeLabel = 'Close',
  showCloseButton = true,
  portalElem,
  className,
  children,
  ...rest
}: BottomSheetProps) {
  // ── Show state ────────────────────────────────────────────────────────
  const [internalShow, setInternalShow] = useState(defaultShow);
  const isControlled = showProp !== undefined;
  const isOpen = isControlled ? showProp : internalShow;

  const handleClose = useCallback(() => {
    if (!isControlled) setInternalShow(false);
    onClose?.();
  }, [isControlled, onClose]);

  // Tracked separately from `isOpen` so the surface can paint its initial
  // off-screen frame before the browser composites the slide-up transform.
  // Mirrors `Panel`'s `panelOpen` mechanism.
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      setSheetOpen(false);
      return;
    }
    const raf = requestAnimationFrame(() => setSheetOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // Escape-to-close. `@ux/disrupt` only fires its own Escape handler when focus
  // sits inside the locked region; we open with `autoFocus: false` (no forced
  // focus jump on a tap-opened sheet), so we wire Escape explicitly at the
  // document level to guarantee the dismissal works regardless of focus.
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // Bail if a closer layer (e.g. `@ux/disrupt`'s own focus-lock Escape, or
      // a nested popover) already handled this Escape — avoids a double close.
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  // Accessible name: an explicit consumer `aria-labelledby` always wins; else a
  // string `title` is wired via the internal title id; else the consumer
  // supplies aria-label / aria-labelledby (enforced by the props union).
  // `aria-label`/`aria-labelledby` arrive through `...rest`.
  const titleId = useId();
  const explicitLabelledBy: string | undefined = rest['aria-labelledby'] as string | undefined;
  const labelledById: string | undefined =
    explicitLabelledBy ?? (typeof title === 'string' ? titleId : undefined);

  // Resolve portal target synchronously so Disrupt receives a stable target on
  // the first open render. Guards `document` for SSR safety.
  const target = portalElem ?? (typeof document !== 'undefined' ? document.body : undefined);

  if (!isOpen) return null;

  return (
    <Disrupt
      className="airo-surfaces-bottom-sheet"
      strategy="fixed"
      portalElem={target}
      focusLock={{ autoFocus: false, returnFocus: true, disabled: false }}
      onClose={handleClose}
      fullScreenChildren
    >
      {/* Scrim — sibling of the sheet. Disrupt's `fullScreenChildren` strips its
          own backdrop styling, so we render this dim-and-fade-in tap target.
          Keyboard users dismiss via Escape (the document-level handler above). */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: role="presentation" is intentionally non-interactive for keyboard users; Escape-to-close is handled by the document-level keydown handler above */}
      <div
        role="presentation"
        className={classnames('airo-surfaces-bottom-sheet__scrim', {
          'airo-surfaces-bottom-sheet__scrim--open': sheetOpen,
        })}
        onClick={handleClose}
      />
      <div
        {...rest}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        className={classnames(
          'airo-surfaces-bottom-sheet__sheet',
          { 'airo-surfaces-bottom-sheet__sheet--open': sheetOpen },
          className,
        )}
      >
        {/* Decorative grab-handle pill, centered at the top edge. The sheet is
            not itself draggable; the handle is the familiar affordance that this
            surface is dismissible (scrim tap / Escape / X). `aria-hidden`. */}
        <DragHandle
          orientation="horizontal"
          className="airo-surfaces-bottom-sheet__drag-handle"
        />
        {/* Header: optional title (text-lockup, Small) + optional corner X.
            `position: relative` (see styles) anchors the absolutely-positioned
            corner action to the sheet's top edge. Omitted entirely when there is
            neither a title nor a dismiss button — the drag handle above is then
            the only header affordance (scrim tap / Escape still dismiss). */}
        {title != null || showCloseButton ? (
          <div className="airo-surfaces-bottom-sheet__header">
            {title != null ? <TextLockup id={titleId} size="sm" title={title} /> : <span />}
            {showCloseButton ? (
              <CornerActions space="md">
                <Button
                  design="control"
                  size="small"
                  icon={<AsyncIcon icon="x" />}
                  aria-label={closeLabel}
                  onClick={handleClose}
                />
              </CornerActions>
            ) : null}
          </div>
        ) : null}
        <div className="airo-surfaces-bottom-sheet__body">{children}</div>
      </div>
    </Disrupt>
  );
}
