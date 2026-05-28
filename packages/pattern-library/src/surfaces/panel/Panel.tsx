import Disrupt from '@ux/disrupt';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AiroHeader, PanelChrome } from '../panel-chrome';

/**
 * Base props for `Panel` — everything except the accessible-name fields,
 * which are enforced separately via {@link PanelLabelProps}.
 */
interface PanelBaseProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'aria-label' | 'aria-labelledby'> {
  /**
   * Whether the panel is visible. Controlled. Pair with `onClose`.
   */
  show?: boolean;
  /**
   * Initial visibility when uncontrolled.
   * @default false
   */
  defaultShow?: boolean;
  /**
   * Fires when the user attempts to dismiss the panel — Escape key,
   * scrim click, or the default corner-action close button.
   */
  onClose?: () => void;
  /**
   * Render a dimmed `@ux/disrupt` scrim behind the panel and trap focus
   * while open. When `false`, the panel renders through a plain portal
   * without a scrim or focus trap (non-modal drawer pattern) and still
   * closes on Escape.
   * @default true
   */
  showDisrupt?: boolean;
  /**
   * Title — matches `@ux/modal`'s `title: ReactNode` semantics. Used by the
   * default header. A **string** title is the simplest way to satisfy the
   * accessible-name requirement; it is wired to `aria-labelledby` on the
   * default-header path and falls back to `aria-label` on custom-header paths.
   * Non-string nodes are accepted for display purposes but do not automatically
   * produce an accessible name — supply `aria-label` or `aria-labelledby` when
   * `title` is not a string.
   */
  title?: ReactNode;
  /**
   * Corner actions slot. Pass `null` to hide the corner actions entirely;
   * pass a node to replace them.
   * @default <CornerActions> with expand and close buttons
   */
  cornerActions?: ReactNode;
  /**
   * Accessible label for the default close button.
   * @default "Close"
   */
  closeLabel?: string;
  /**
   * Whether the panel is expanded to fill the full viewport. Controlled.
   * Pair with `onExpandedChange`.
   */
  expanded?: boolean;
  /**
   * Initial expansion state when uncontrolled.
   * @default false
   */
  defaultExpanded?: boolean;
  /**
   * Fires when the user toggles the expand/collapse button in the default
   * corner actions.
   */
  onExpandedChange?: (expanded: boolean) => void;
  /**
   * Accessible label for the default expand button.
   * @default "Expand"
   */
  expandLabel?: string;
  /**
   * Accessible label for the default collapse button (shown when the panel
   * is expanded).
   * @default "Collapse"
   */
  collapseLabel?: string;
  /**
   * Header slot. Pass `null` to omit the header entirely; pass a node to
   * replace it.
   * @default <TextLockup title={title} /> paired with cornerActions
   */
  header?: ReactNode;
  /**
   * Hide-on-scroll-down / reveal-on-scroll-up behavior for the header.
   * When `false`, the header is statically pinned and never translates out
   * of view.
   * @default true
   */
  stickyHeader?: boolean;
  /**
   * Scrollable body content.
   */
  children?: ReactNode;
  /**
   * Footer slot. Sticky to the trailing edge of the panel; slides in from
   * the viewport bottom when shown. Hidden automatically when nullish or
   * when `hideFooter` is `true`.
   */
  footer?: ReactNode;
  /**
   * Explicitly hide the footer (it will slide out to the viewport bottom).
   * Also implicitly hidden when `footer` is nullish.
   */
  hideFooter?: boolean;
  /**
   * Footer band treatment inside `PanelChrome`. Forwarded unchanged.
   *
   * - **`default`** — solid footer band, shadow, padded inner `Box`.
   * - **`floating`** — transparent band, no footer shadow, **`lg`** horizontal
   *   gutter and **`md`** bottom gutter (for **`FloatingFooter`** + borderless composers).
   *
   * @default 'default'
   */
  footerChrome?: 'default' | 'floating';
  /**
   * Automatic scroll-to-bottom strategy for the content area.
   *
   * - `'smart-bottom'` — scrolls to the bottom when content changes, but
   *   pauses if the user has scrolled more than `autoScrollThreshold` px away
   *   from the bottom. Scrolling back near the bottom re-engages it. Useful
   *   for streaming / live-update panels.
   */
  autoScroll?: 'smart-bottom';
  /**
   * Distance in px from the scroll bottom at which `autoScroll` is considered
   * "near the bottom" and re-engages after the user has scrolled away.
   * @default 144
   */
  autoScrollThreshold?: number;
  /**
   * Portal target. Forwarded to `@ux/disrupt` when `showDisrupt` is `true`.
   * @default document.body
   */
  portalElem?: HTMLElement;
}

/**
 * Enforces that every `Panel` carries an accessible name. Exactly one of the
 * three branches must be satisfied:
 *
 * - **`title: string`** — simplest; the default header renders it inside a
 *   labelled `<span>` and the panel root points `aria-labelledby` at it.
 * - **`aria-label: string`** — use when `title` is non-string (e.g. a logo
 *   node) or when a custom `header` is supplied and no element id is available.
 * - **`aria-labelledby: string`** — use when a custom `header` renders its own
 *   labelling element and you can supply its id.
 */
type PanelLabelProps =
  | { title: string; 'aria-label'?: string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label': string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label'?: string; 'aria-labelledby': string };

/**
 * Props for configuring the panel container, header content, and open state.
 *
 * **Accessible name requirement** — the panel renders as `role="dialog"` (modal)
 * or `role="complementary"` (non-modal). Both landmarks require an accessible
 * name. Satisfy it with one of:
 * - a string `title` (simplest — used by the default header),
 * - an explicit `aria-label`, or
 * - an `aria-labelledby` pointing at a heading in a custom `header`.
 */
export type PanelProps = PanelBaseProps & PanelLabelProps;

/**
 * `Panel` is an edge-attached overlay surface built on `@ux/disrupt`. It slides
 * in from the viewport's trailing edge (right in LTR, left in RTL), fades in
 * an optional scrim behind it, and exposes slots for a header, scrollable
 * content, and a sticky footer.
 *
 * Like `@ux/modal`, it takes a `title` ReactNode used by the default header,
 * supports controlled (`show`) and uncontrolled (`defaultShow`) visibility,
 * and fires `onClose` on any dismissal intent (Escape, scrim click, or the
 * default corner-action close button).
 *
 * Inner UI (header band, scrollable content, sticky footer, focus
 * management) is delegated to `PanelChrome` from
 * `@airo-ux/pattern-library/surfaces/panel-chrome`. `Panel` owns the slide-in
 * transform, optional scrim, full-viewport expand mode, and the
 * Disrupt-vs-plain-portal host choice.
 */
function PanelRoot({
  show: showProp,
  defaultShow = false,
  onClose,
  showDisrupt = true,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  portalElem,
  className,
  ...rest
}: PanelProps) {
  const [internalShow, setInternalShow] = useState(defaultShow);
  const isControlled = showProp !== undefined;
  const isOpen = isControlled ? showProp : internalShow;

  // Tracked separately from `isOpen` so the surface can paint its initial
  // off-screen frame before the browser composites the slide-in transform.
  // Kicked off via rAF in this component's useEffect once it has mounted.
  const [panelOpen, setPanelOpen] = useState(false);

  // Mirror PanelChrome's controlled/uncontrolled expanded handling at this
  // level so the expand/collapse modifier on the panel root stays in sync
  // when expansion is uncontrolled. PanelChrome maintains its own internal
  // copy for the corner-action toggle button; we read this one for the
  // surface-level width swap.
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpandedControlled = expandedProp !== undefined;
  const isExpanded = isExpandedControlled ? expandedProp : internalExpanded;

  const handleExpandedChange = useCallback(
    (next: boolean) => {
      if (!isExpandedControlled) {
        setInternalExpanded(next);
      }
      onExpandedChange?.(next);
    },
    [isExpandedControlled, onExpandedChange],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalShow(next);
      }
    },
    [isControlled],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose, setOpen]);

  // Trigger the slide-in on mount. Keep the transform in a data attribute so
  // the browser paints the initial off-screen frame before we flip it to 0.
  useEffect(() => {
    if (!isOpen) {
      setPanelOpen(false);
      return;
    }
    const raf = requestAnimationFrame(() => setPanelOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  if (!isOpen) return null;

  /* In the modal path we compose on @ux/disrupt with `fullScreenChildren`, which
     deliberately strips Disrupt's own backdrop styling (`background: none`) so
     consumers can supply their own fullscreen layout. We render a sibling scrim
     here — fades in, click-to-close, pointer-events only while open. */
  const scrim = showDisrupt ? (
    // biome-ignore lint/a11y/useKeyWithClickEvents: role="presentation" is intentionally non-interactive for keyboard users; Escape-to-close is handled by Disrupt's focus trap
    <div
      role="presentation"
      className={classnames('airo-surfaces-panel__scrim', {
        'airo-surfaces-panel__scrim--open': panelOpen,
      })}
      onClick={handleClose}
    />
  ) : null;

  const body = (
    <>
      {scrim}
      <PanelChrome
        {...rest}
        className={classnames('airo-surfaces-panel__panel', className, {
          'airo-surfaces-panel__panel--open': panelOpen,
          'airo-surfaces-panel__panel--expanded': isExpanded,
        })}
        expanded={isExpanded}
        onExpandedChange={handleExpandedChange}
        onClose={handleClose}
        modal={showDisrupt}
      />
    </>
  );

  if (showDisrupt) {
    return (
      <Disrupt
        className="airo-surfaces-panel"
        strategy="fixed"
        portalElem={portalElem ?? (typeof document !== 'undefined' ? document.body : undefined)}
        focusLock={{ autoFocus: false, returnFocus: true, disabled: false }}
        onClose={handleClose}
        fullScreenChildren
      >
        {body}
      </Disrupt>
    );
  }

  return <PanelPortal portalElem={portalElem}>{body}</PanelPortal>;
}

interface PanelPortalProps {
  portalElem?: HTMLElement;
  children: ReactNode;
}

/**
 * Fallback portal used when `showDisrupt={false}`. Mounts the panel on
 * `document.body` and wires Escape-to-close + focus-restore, but without a
 * focus trap — matching non-modal drawer conventions.
 */
function PanelPortal({ portalElem, children }: PanelPortalProps) {
  const [mountTarget, setMountTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (portalElem) {
      setMountTarget(portalElem);
      return;
    }
    if (typeof document !== 'undefined') {
      setMountTarget(document.body);
    }
  }, [portalElem]);

  if (!mountTarget) return null;
  return createPortal(
    <div className="airo-surfaces-panel airo-surfaces-panel--no-scrim">{children}</div>,
    mountTarget,
  );
}

/**
 * Edge-attached overlay surface that slides in from the viewport's trailing
 * edge (right in LTR, left in RTL). Supports controlled and uncontrolled
 * visibility, an optional scrim + focus-trap, and slots for a header,
 * scrollable body, and sticky footer.
 *
 * @example
 * ```tsx
 * // Controlled — modal drawer with default header and footer
 * const [open, setOpen] = useState(false);
 *
 * <Panel show={open} onClose={() => setOpen(false)} title="Settings" footer={<Button>Save</Button>}>
 *   <p>Panel body content</p>
 * </Panel>
 * ```
 *
 * @example
 * ```tsx
 * // Non-modal drawer — no scrim, no focus trap
 * <Panel defaultShow showDisrupt={false} title="Details">
 *   <p>Supplementary content</p>
 * </Panel>
 * ```
 *
 * @see {@link PanelProps} for the full prop reference
 */
export const Panel = Object.assign(PanelRoot, {
  AiroHeader,
});
