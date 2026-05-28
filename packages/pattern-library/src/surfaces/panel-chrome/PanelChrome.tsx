import Box from '@ux/box';
import TextLockup from '@ux/text-lockup';
import classnames from 'classnames';
import {
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEventHandler,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { renderDefaultCornerActions } from './AiroHeader';

/**
 * Base props for `PanelChrome` — everything except the accessible-name
 * fields, which are enforced separately via {@link PanelChromeLabelProps}.
 */
interface PanelChromeBaseProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'aria-label' | 'aria-labelledby'> {
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
   * @default expand + close buttons via `renderDefaultCornerActions`
   */
  cornerActions?: ReactNode;
  /**
   * Accessible label for the default close button.
   * @default "Close"
   */
  closeLabel?: string;
  /**
   * Whether the chrome is expanded (e.g. surface fills more of the
   * viewport). Controlled. Pair with `onExpandedChange`.
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
   * Accessible label for the default collapse button (shown when the
   * chrome is expanded).
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
   * Footer slot. Rendered in normal DOM flow below the scrollable content;
   * collapses with an animated height transition when hidden. Hidden
   * automatically when nullish or when `hideFooter` is `true`.
   */
  footer?: ReactNode;
  /**
   * Explicitly hide the footer (it will collapse with an animated height
   * transition). Also implicitly hidden when `footer` is nullish.
   */
  hideFooter?: boolean;
  /**
   * Visual treatment of the footer **band** (the `PanelChrome` region that
   * wraps `footer`).
   *
   * - **`default`** — solid footer background, top edge shadow, and the
   *   standard padded inner `Box` (`blockPadding="sm"`, `inlinePadding="lg"`).
   * - **`floating`** — transparent band, **no** footer shadow, **no** top
   *   padding on the inner gutter; **inline** padding uses the **`lg`** density
   *   step (`×3`) and **block-end** uses **`md`** (`×2`), matching `@ux/box`
   *   `inlinePadding="lg"` / `blockPadding="md"` spacing. Use when `footer` is a
   *   **`FloatingFooter`** + borderless composer (or similar) that brings its own
   *   raised/card depth — see **Examples / Chat Panel → Fixed conversation
   *   (floating composer)**.
   *
   * @default 'default'
   */
  footerChrome?: 'default' | 'floating';
  /**
   * Renders a drag-handle pill centered at the top of the header band.
   * Use on draggable surfaces (e.g. `FloatingPanel`) so users get a clear
   * affordance for the drag interaction. The pill fades from 40 % → 100 %
   * opacity on header hover with a 0.2 s transition.
   *
   * When `true`, the pill is keyboard-focusable (`tabIndex={0}`) and exposes
   * an accessible label (`dragHandleLabel`) so keyboard users can Tab to it
   * and use Arrow keys to reposition the panel.
   *
   * @default false
   */
  dragHandle?: boolean;
  /**
   * Accessible label for the drag-handle pill. Announced to screen readers
   * when the handle receives focus. Ignored when `dragHandle` is falsy.
   *
   * @default "Move panel — use Arrow keys"
   */
  dragHandleLabel?: string;
  /**
   * Visual treatment of the header band.
   *
   * - **`default`** — frosted-glass background, drop shadow.
   * - **`ghost`** — fully transparent, no shadow, no backdrop blur. Use when
   *   the header is only a drag-handle affordance and the actual surface header
   *   lives elsewhere (e.g. a full-width app bar in the builder docked layout).
   *
   * @default 'default'
   */
  headerChrome?: 'default' | 'ghost';
  /**
   * `pointerdown` handler attached to the drag-handle pill. Use on docked
   * surfaces (e.g. `FloatingPanel` in snapped mode) to enable drag-to-undock:
   * the surface listens for pointer movement and undocks when the threshold
   * is crossed.
   */
  onDragHandlePointerDown?: PointerEventHandler<HTMLDivElement>;
  /**
   * Fires when the user attempts to dismiss the surface — Escape key (in
   * non-modal mode) or the default corner-action close button. The host
   * surface is responsible for calling whatever it uses for dismissal
   * (e.g. updating its `show` state).
   */
  onClose: () => void;
  /**
   * Controls the surface's ARIA role, `aria-modal` attribute, and
   * which side handles Escape-to-close and focus restore.
   *
   * - `true` — **modal dialog**: `role="dialog"` + `aria-modal="true"`.
   *   The host surface (e.g. `@ux/disrupt`) owns Escape and focus restore.
   * - `false` (default) — **non-modal landmark**: `role="complementary"`.
   *   The chrome listens for Escape on its root and restores focus on unmount.
   * - `"non-modal-dialog"` — **non-modal dialog**: `role="dialog"` +
   *   `aria-modal="false"`. The chrome still handles Escape and focus restore
   *   like the `false` path. Use for surfaces like `FloatingPanel` that should
   *   announce as a dialog (screen readers enter/exit dialog mode) while still
   *   leaving the rest of the page accessible.
   *
   * @default false
   */
  modal?: boolean | 'non-modal-dialog';
  /**
   * Auto-scroll policy for the content region.
   *
   * - `'smart-bottom'` — scrolls to the bottom whenever the scroll content
   *   changes (new child nodes or text updates), **unless** the user has
   *   scrolled more than `autoScrollThreshold` px away from the bottom —
   *   indicating intentional upward browsing. Scroll calls are coalesced to
   *   one per animation frame so streaming updates stay smooth.
   *
   * @default undefined (no auto-scroll)
   */
  autoScroll?: 'smart-bottom';
  /**
   * Distance from the scroll bottom (in px) above which `autoScroll` will not
   * fire, preserving the user's scroll position. Only meaningful when
   * `autoScroll="smart-bottom"`.
   *
   * @default 144
   */
  autoScrollThreshold?: number;
}

/**
 * Enforces that every `PanelChrome` carries an accessible name. At least
 * one of the three branches must be satisfied:
 *
 * - **`title: string`** — simplest; the default header renders it inside a
 *   labelled `<span>` and the chrome root points `aria-labelledby` at it.
 * - **`aria-label: string`** — use when `title` is non-string (e.g. a logo
 *   node) or when a custom `header` is supplied and no element id is available.
 * - **`aria-labelledby: string`** — use when a custom `header` renders its own
 *   labelling element and you can supply its id.
 */
type PanelChromeLabelProps =
  | { title: string; 'aria-label'?: string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label': string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label'?: string; 'aria-labelledby': string };

/**
 * Props for configuring the chrome container, header content, and footer
 * behavior.
 *
 * **Accessible name requirement** — the chrome renders as `role="dialog"`
 * (when `modal`) or `role="complementary"` (non-modal). Both landmarks
 * require an accessible name. Satisfy it with one of:
 * - a string `title` (simplest — used by the default header),
 * - an explicit `aria-label`, or
 * - an `aria-labelledby` pointing at a heading in a custom `header`.
 */
export type PanelChromeProps = PanelChromeBaseProps & PanelChromeLabelProps;

/**
 * `PanelChrome` is the inner UI shared by every Airo surface component
 * (`Panel`, `FloatingPanel`, `FullscreenDialog`, …). It owns the header
 * band (with optional hide-on-scroll-down behavior), the scrollable
 * content region, the sticky footer with slide animation, focus
 * management, and the dialog/complementary landmark semantics.
 *
 * Each surface composes `PanelChrome` to get a consistent interior, then
 * supplies its own positioning, animation, scrim, and host strategy
 * (Disrupt, plain portal, fixed-edge, draggable window, …).
 *
 * The chrome forwards `className` and `data-*` to its root element so
 * surfaces can attach surface-specific positioning classes (e.g.
 * `airo-surfaces-panel__panel airo-surfaces-panel__panel--open`) without
 * having to nest extra DOM nodes.
 *
 * @example
 * ```tsx
 * // Inside a surface component
 * <PanelChrome
 *   title="Settings"
 *   onClose={handleClose}
 *   modal={true}
 *   className="airo-surfaces-panel__panel"
 *   footer={<Composer />}
 * >
 *   <Box inlinePadding="lg">…</Box>
 * </PanelChrome>
 * ```
 *
 * @see {@link PanelChromeProps} for the full prop reference.
 */
export function PanelChrome({
  title,
  cornerActions,
  closeLabel = 'Close',
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  expandLabel = 'Expand',
  collapseLabel = 'Collapse',
  header,
  stickyHeader = true,
  footer,
  hideFooter = false,
  footerChrome = 'default',
  headerChrome = 'default',
  dragHandle = false,
  dragHandleLabel = 'Move panel — use Arrow keys',
  onDragHandlePointerDown,
  onClose,
  modal = false,
  className,
  children,
  autoScroll,
  autoScrollThreshold = 144,
  'aria-label': ariaLabelProp,
  'aria-labelledby': ariaLabelledByProp,
  ...rest
}: PanelChromeProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  // Whether the auto-scroll should currently be tracking the bottom.
  // Starts true; flipped to false when the user intentionally scrolls up;
  // flipped back to true when the user scrolls back within autoScrollThreshold
  // of the bottom. Stored as a ref (not state) so the MutationObserver and
  // scroll callbacks always read the current value without re-subscribing.
  const shouldAutoScrollRef = useRef(true);
  const titleId = useId();
  const previousFocusRef = useRef<Element | null>(null);

  const [headerHidden, setHeaderHidden] = useState(false);
  // Live ref so the ResizeObserver closure always reads the latest hide state
  // without needing to re-register on every toggle.
  const headerHiddenRef = useRef(false);
  headerHiddenRef.current = headerHidden;

  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpandedControlled = expandedProp !== undefined;
  const isExpanded = isExpandedControlled ? expandedProp : internalExpanded;

  const handleExpandedToggle = useCallback(() => {
    const next = !isExpanded;
    if (!isExpandedControlled) {
      setInternalExpanded(next);
    }
    onExpandedChange?.(next);
  }, [isExpanded, isExpandedControlled, onExpandedChange]);

  /* The footer region is mounted whenever the consumer provides `footer`.
     `hideFooter` slides it off-screen without unmounting so inputs inside
     the footer retain their value between hide/show toggles. When `footer`
     is nullish the region is never mounted — no animation in that path. */
  const footerProvided = footer != null;
  const footerHidden = hideFooter;

  /* `modal === true`  → surface owns Escape + focus restore (Disrupt path).
     `modal === false | 'non-modal-dialog'` → chrome owns Escape + focus restore.
     Move focus into the chrome on mount regardless of mode. */
  const chromeOwnsInteraction = modal !== true;

  useEffect(() => {
    if (chromeOwnsInteraction) {
      previousFocusRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    }
    panelRef.current?.focus();
    if (!chromeOwnsInteraction) return;
    return () => {
      const previous = previousFocusRef.current;
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [chromeOwnsInteraction]);

  /* Escape-to-close for the non-modal paths (modal===false or 'non-modal-dialog').
     Handled via onKeyDown on the chrome root so only the focused surface closes. */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (chromeOwnsInteraction && event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    },
    [chromeOwnsInteraction, onClose],
  );

  /* Hide-on-scroll-down / reveal-on-scroll-up. rAF-throttled so the scroll
     handler never blocks the main thread. Skipped when stickyHeader is off. */
  useEffect(() => {
    if (!stickyHeader) {
      setHeaderHidden(false);
      return;
    }
    const scroller = contentRef.current;
    if (!scroller) return;

    let lastTop = scroller.scrollTop;
    let frame = 0;
    const HIDE_THRESHOLD = 24;
    const DELTA_THRESHOLD = 4;

    const handleScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const currentTop = scroller.scrollTop;
        const delta = currentTop - lastTop;
        /* Near the top we always reveal the header regardless of direction
           or velocity — otherwise a slow upward scroll (per-frame deltas
           smaller than DELTA_THRESHOLD) would never cross the reveal branch
           and the header would stay hidden at scrollTop ≈ 0. */
        if (currentTop <= HIDE_THRESHOLD) {
          setHeaderHidden(false);
        } else if (delta > DELTA_THRESHOLD) {
          setHeaderHidden(true);
        } else if (delta < -DELTA_THRESHOLD) {
          setHeaderHidden(false);
        }
        lastTop = currentTop;
      });
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [stickyHeader]);

  /* Track header height → set --airo-pchr-header-h on the root so the
     content area can pad itself out from under the absolutely-positioned
     header. Re-runs when the header presence changes (e.g. header=null). */
  const effectiveHeader =
    header === undefined
      ? renderDefaultHeader({
          title,
          cornerActions,
          closeLabel,
          onClose,
          titleId,
          isExpanded,
          onExpandedToggle: handleExpandedToggle,
          expandLabel,
          collapseLabel,
        })
      : header;

  const hasHeader = effectiveHeader != null;

  /* Set --airo-pchr-header-h to the header's natural (fully-expanded) height so
     the content's padding-block-start always clears the floating header band.

     The ResizeObserver only writes the variable while the header is visible
     (headerHiddenRef.current === false). During the hide animation the observer
     fires with shrinking values — ignoring them keeps --airo-pchr-header-h at the
     full height so scrollHeight (and therefore scrollTop) stays stable. Resizes
     that happen while the header is visible (screen resize, docked-panel drag) are
     picked up immediately. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasHeader is the stable signal; re-measuring when header presence changes is the intent
  useLayoutEffect(() => {
    const root = panelRef.current;
    if (!root) return;

    const headerEl = headerRef.current;
    if (!headerEl) {
      root.style.setProperty('--airo-pchr-header-h', '0px');
      return;
    }

    // Synchronous measurement before first paint.
    const h = headerEl.getBoundingClientRect().height;
    if (h > 0) root.style.setProperty('--airo-pchr-header-h', `${h}px`);

    if (typeof ResizeObserver === 'undefined') return;
    const ob = new ResizeObserver((entries) => {
      // Ignore all updates while hidden — the collapsing animation drives blockSize
      // toward 0 but we want the padding to stay at the full header height.
      if (headerHiddenRef.current) return;
      const entry = entries[0];
      const blockSize = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height ?? 0;
      if (blockSize === 0) return;
      root.style.setProperty('--airo-pchr-header-h', `${blockSize}px`);
    });
    ob.observe(headerEl);
    return () => ob.disconnect();
  }, [hasHeader]);

  /* Smart auto-scroll: scroll to the bottom as content arrives, but pause
     when the user intentionally scrolls up and re-engage when they scroll
     back near the bottom.

     Intent is tracked via a scroll listener on the content element rather
     than by measuring distFromBottom inside the MutationObserver callback.
     Measuring in the callback conflates two different signals: "user scrolled
     away" and "new content pushed the bottom further down". A large
     distFromBottom after a mutation (e.g. a whole user message or ChoiceList
     appearing at once) looks identical to a deliberate upward scroll unless
     we separately know the direction of the last user scroll.

     Scroll-event logic:
       - distFromBottom ≤ threshold → near bottom → re-engage (always)
       - scrollTop decreased          → user scrolled up → disengage
       - scrollTop increased but not near bottom → keep existing state
         (covers programmatic down-scrolls catching up to new content)

     MutationObserver:
       - `characterData: true` is required for streaming, which updates text
         nodes in place rather than inserting new child elements.
       - `scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight` scrolls
         to the bottom without relying on jsdom's unclamped behaviour. Browsers clamp
         `scrollTop` to `scrollHeight - clientHeight`; using that value directly is
         both correct and testable with a real clamped assertion. Direct assignment
         bypasses `scroll-behavior: smooth` and is universally supported. */
  useEffect(() => {
    if (autoScroll !== 'smart-bottom') return;
    const scroller = contentRef.current;
    if (!scroller) return;

    // Initialise intent based on current position so toggling the prop on
    // while the user is already scrolled up doesn't immediately snap them down.
    const initialDist = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    shouldAutoScrollRef.current = initialDist <= autoScrollThreshold;

    let lastScrollTop = scroller.scrollTop;

    // Coalesce scroll-to-bottom work to once per animation frame. Streaming
    // text can fire many characterData mutations per frame; batching to rAF
    // avoids redundant work while still keeping up with fast updates.
    let rafId = 0;
    const checkAndScroll = () => {
      // Skip rAF scheduling entirely when disengaged to avoid unnecessary queue
      // churn during streaming while the user is reading earlier content.
      if (!shouldAutoScrollRef.current) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        // Re-check inside rAF to handle the race where the user scrolls up
        // between checkAndScroll() and the frame firing.
        if (!shouldAutoScrollRef.current) return;
        // Direct assignment guarantees an instant jump regardless of the
        // element's scroll-behavior CSS; scrollTo({ behavior:'auto' }) would
        // follow scroll-behavior: smooth and cause scrollTop to lag.
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      });
    };

    const handleScroll = () => {
      const currentScrollTop = scroller.scrollTop;
      const distFromBottom = scroller.scrollHeight - currentScrollTop - scroller.clientHeight;

      if (distFromBottom <= autoScrollThreshold) {
        // Near the bottom — re-engage regardless of direction.
        shouldAutoScrollRef.current = true;
      } else if (currentScrollTop < lastScrollTop) {
        // User scrolled up — disengage.
        shouldAutoScrollRef.current = false;
      }
      // Scrolled down but not yet near bottom (e.g. programmatic catch-up):
      // preserve existing intent.

      lastScrollTop = currentScrollTop;
    };

    const observer = new MutationObserver(checkAndScroll);
    observer.observe(scroller, { childList: true, subtree: true, characterData: true });
    scroller.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [autoScroll, autoScrollThreshold]);

  // Only wire titleId when the default header is active — that is the only path
  // where <span id={titleId}> is rendered. Custom or null headers leave no
  // matching element in the DOM, so fall back to aria-label instead.
  const defaultHeaderActive = header === undefined;
  const labelledBy =
    ariaLabelledByProp ?? (defaultHeaderActive && typeof title === 'string' ? titleId : undefined);
  const ariaLabel = ariaLabelProp ?? (!labelledBy && typeof title === 'string' ? title : undefined);

  // Resolve ARIA role + aria-modal from the three modal modes.
  const ariaRole = modal === false ? 'complementary' : 'dialog';
  const ariaModalAttr = modal === true ? true : modal === 'non-modal-dialog' ? false : undefined;

  // Warn in development when neither aria-label nor aria-labelledby will be
  // set, leaving the landmark without an accessible name.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally runs once on mount; labeling props are established before first paint
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && !ariaLabel && !labelledBy) {
      console.warn(
        `[PanelChrome] Missing accessible name on role="${ariaRole}". Provide a string title, aria-label, or aria-labelledby so assistive technologies can identify the surface.`,
      );
    }
  }, []);

  return (
    <div
      {...rest}
      ref={panelRef}
      className={classnames('airo-surfaces-panel-chrome', className)}
      role={ariaRole}
      aria-modal={ariaModalAttr}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={(event) => {
        rest.onKeyDown?.(event);
        handleKeyDown(event);
      }}
    >
      {effectiveHeader ? (
        <div
          ref={headerRef}
          className={classnames('airo-surfaces-panel-chrome__header', {
            'airo-surfaces-panel-chrome__header--sticky': stickyHeader,
            'airo-surfaces-panel-chrome__header--hidden': headerHidden,
            'airo-surfaces-panel-chrome__header--draggable': dragHandle,
            'airo-surfaces-panel-chrome__header--ghost': headerChrome === 'ghost',
          })}
          data-hidden={headerHidden ? 'true' : 'false'}
        >
          {dragHandle && (
            <div
              className="airo-surfaces-panel-chrome__drag-handle"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-movable panels need a focusable drag handle so Arrow-key repositioning is reachable via the keyboard.
              tabIndex={0}
              aria-label={dragHandleLabel}
              onPointerDown={onDragHandlePointerDown}
            />
          )}
          <Box
            className="airo-surfaces-panel-chrome__header-body"
            blockPadding="md"
            inlinePadding="lg"
          >
            {effectiveHeader}
          </Box>
        </div>
      ) : null}

      <section
        ref={contentRef}
        className="airo-surfaces-panel-chrome__content"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable content regions must be keyboard-focusable so keyboard-only users can scroll with arrow keys and PageUp/PageDown.
        tabIndex={0}
        aria-label={typeof title === 'string' ? title : ariaLabel}
        aria-labelledby={typeof title === 'string' ? undefined : labelledBy}
      >
        {children}
      </section>

      {footerProvided ? (
        <div
          className={classnames('airo-surfaces-panel-chrome__footer', {
            'airo-surfaces-panel-chrome__footer--hidden': footerHidden,
            'airo-surfaces-panel-chrome__footer--floating': footerChrome === 'floating',
          })}
          data-hidden={footerHidden ? 'true' : 'false'}
          // `inert` removes the collapsed footer from the tab order and accessibility
          // tree so keyboard users cannot reach hidden controls. DOM stays mounted to
          // preserve input state across hide/show toggles.
          // @ts-expect-error -- `inert` is a valid HTML attribute not yet typed in @types/react@18
          inert={footerHidden ? '' : undefined}
        >
          <div className="airo-surfaces-panel-chrome__footer-body">
            {footerChrome === 'floating' ? (
              <div className="airo-surfaces-panel-chrome__footer-body-skin airo-surfaces-panel-chrome__footer-body-skin--floating">
                {footer}
              </div>
            ) : (
              <Box blockPadding="sm" inlinePadding="lg">
                {footer}
              </Box>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface DefaultHeaderArgs {
  title: ReactNode;
  cornerActions: ReactNode;
  closeLabel: string;
  onClose: () => void;
  titleId: string;
  isExpanded: boolean;
  onExpandedToggle: () => void;
  expandLabel: string;
  collapseLabel: string;
}

/**
 * Default header: TextLockup with the title, paired with a corner-actions
 * expand and close button. Returns `null` if neither title nor corner actions
 * would render any content.
 */
function renderDefaultHeader({
  title,
  cornerActions,
  closeLabel,
  onClose,
  titleId,
  isExpanded,
  onExpandedToggle,
  expandLabel,
  collapseLabel,
}: DefaultHeaderArgs): ReactNode {
  const effectiveCornerActions =
    cornerActions === undefined
      ? renderDefaultCornerActions({
          closeLabel,
          onClose,
          expanded: isExpanded,
          expandLabel,
          collapseLabel,
          onExpandedToggle,
        })
      : cornerActions;

  if (title == null && effectiveCornerActions == null) return null;

  return (
    <Box
      orientation="horizontal"
      gap="sm"
      blockAlignChildren="spaceBetween"
      inlineAlignChildren="center"
      className="airo-surfaces-panel-chrome__header-inner"
    >
      {title != null ? (
        <TextLockup
          size="lg"
          title={typeof title === 'string' ? <span id={titleId}>{title}</span> : title}
        />
      ) : (
        <span />
      )}
      {effectiveCornerActions}
    </Box>
  );
}
