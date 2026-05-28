import classnames from 'classnames';
import {
  type HTMLAttributes,
  type ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { CanvasStatus } from './CanvasStatus';

/**
 * Props for `Canvas`.
 */
export interface CanvasProps extends HTMLAttributes<HTMLElement> {
  /**
   * Primary content rendered inside the canvas — typically the AI-generated
   * artifact (an iframe site preview, an editor, an artifact viewer, etc.).
   * The content area is scrollable, so an oversized child fills the
   * remaining space without overflowing the canvas chrome.
   */
  children?: ReactNode;
  /**
   * Optional toolbar / header rendered above the content area. Use this for
   * navigation breadcrumbs, mode-switcher buttons, or any controls that
   * should stay visible while the content scrolls.
   */
  header?: ReactNode;
  /**
   * Optional floating status indicator anchored top-center over the content
   * area. Typically a `<Canvas.Status />` chip, but any node is accepted —
   * Canvas owns the positioning, the consumer owns the visible affordance.
   *
   * Pass `null` (the default) when no status is active; pass a node when an
   * agent action is in flight.
   */
  status?: ReactNode;
  /**
   * When `true` (default), the scrollable content area fades at its top
   * edge while the user is scrolled away from the start, and at its bottom
   * edge while the user is scrolled away from the end. The fade is a CSS
   * `mask-image` applied to the inner scroll container only — it never
   * masks the `header` or `status` slots, both of which sit outside the
   * scrolling region.
   *
   * The fade distance defaults to 56px and can be overridden by setting
   * `--airo-surfaces-canvas-fade-distance` on the canvas (or any ancestor)
   * via `style` or a custom class.
   *
   * Set `fadeOnScroll={false}` to disable the mask entirely — useful when
   * the canvas hosts content that already has its own gradient affordance
   * (e.g. a chat thread with a custom shadow), or when the consumer wants
   * a hard edge.
   *
   * @default true
   */
  fadeOnScroll?: boolean;
}

/**
 * `Canvas` is a `<section>` surface that hosts AI-generated content alongside
 * the chat panel. It owns three slots — `header` (toolbar), `children`
 * (primary content), and `status` (a floating chip pinned top-center) — and
 * provides a themed, rounded chrome with a scrollable content region.
 *
 * Use `Canvas` as the right-hand pane of a dual-pane layout where the chat
 * panel (or `ChatLayout` in `'sidebar'` mode) lives on the left and the AI's
 * rendered output lives on the right. The `status` slot is the canonical
 * place to surface a "the agent is editing this canvas" indicator without
 * blocking interaction with the underlying preview.
 *
 * `Canvas` does not render any portal — the `status` node is a child of the
 * canvas DOM. Consumers who need viewport-anchored or fullscreen-overlaying
 * status chrome should mount `<Canvas.Status />` themselves outside the
 * canvas tree.
 *
 * @example Bare canvas
 * ```tsx
 * <Canvas aria-label="Site preview">
 *   <iframe src={previewUrl} />
 * </Canvas>
 * ```
 *
 * @example With header and floating status
 * ```tsx
 * <Canvas
 *   aria-label="Site preview"
 *   header={<DeviceSwitcher value={device} onChange={setDevice} />}
 *   status={isEditing ? <Canvas.Status label="Editing…" /> : null}
 * >
 *   <iframe src={previewUrl} />
 * </Canvas>
 * ```
 */
const CanvasRoot = forwardRef<HTMLElement, CanvasProps>(function CanvasRoot(
  { children, header, status, fadeOnScroll = true, className, ...rest },
  ref,
) {
  // Local handle on the section element so we can measure it (for
  // viewport-bottom detection) AND still forward whatever ref the consumer
  // passes via `useImperativeHandle`.
  const rootRef = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => rootRef.current as HTMLElement);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Track scroll position so the gradient mask only paints when there is
  // actual overflow on the corresponding side. Both default to `false` so
  // a non-overflowing canvas (or the very-first paint before measurement)
  // renders without any mask.
  const [topFaded, setTopFaded] = useState(false);
  const [bottomFaded, setBottomFaded] = useState(false);

  // True when the canvas's bottom edge is at (or past) the viewport's
  // bottom edge. The CSS modifier class flattens `border-end-start-radius`
  // / `border-end-end-radius` in this state so the canvas reads as flush
  // with the viewport floor instead of a rounded card sitting on top of
  // it. Recomputed on scroll, viewport resize, and any size change of the
  // canvas itself.
  const [atViewportBottom, setAtViewportBottom] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined') return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      // 1px tolerance for sub-pixel layouts; "touching" includes "past."
      setAtViewportBottom(rect.bottom >= window.innerHeight - 1);
    };
    update();
    // Coalesce resize + scroll callbacks via rAF to cap layout reads
    // (getBoundingClientRect) at one per animation frame. Passive + capture
    // for the scroll listener: passive matches repo convention (no
    // preventDefault needed); capture catches scroll on nested containers
    // since scroll doesn't bubble.
    let rafVB: ReturnType<typeof requestAnimationFrame> | null = null;
    const onEvent = () => {
      if (rafVB !== null) cancelAnimationFrame(rafVB);
      rafVB = requestAnimationFrame(update);
    };
    window.addEventListener('resize', onEvent);
    window.addEventListener('scroll', onEvent, { capture: true, passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onEvent);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('resize', onEvent);
      window.removeEventListener('scroll', onEvent, { capture: true });
      ro?.disconnect();
      if (rafVB !== null) cancelAnimationFrame(rafVB);
    };
  }, []);

  useEffect(() => {
    if (!fadeOnScroll) {
      // Make sure stale state from a previous render doesn't keep painting
      // a mask once the consumer toggles the fade off.
      setTopFaded(false);
      setBottomFaded(false);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      // 1px tolerance avoids flicker from sub-pixel scroll positions and
      // the half-pixel fractional layouts browsers can produce.
      setTopFaded(scrollTop > 1);
      setBottomFaded(scrollTop + clientHeight < scrollHeight - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    // ResizeObserver catches viewport resizes; MutationObserver catches
    // content additions/removals (streamed chat-like content, dynamically
    // injected previews) so the mask state stays in sync as the overflow
    // boundary shifts under scroll-stationary updates.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    // Coalesce mutation callbacks through rAF so rapid DOM mutations from
    // streaming content (e.g. appended chat tokens) collapse to at most
    // one update per animation frame, capping re-renders at 60/s.
    let raf: ReturnType<typeof requestAnimationFrame> | null = null;
    const onMutation = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    const mo = new MutationObserver(onMutation);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      mo.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [fadeOnScroll]);

  return (
    <section
      {...rest}
      ref={rootRef}
      className={classnames(
        'airo-surfaces-canvas',
        atViewportBottom && 'airo-surfaces-canvas--at-viewport-bottom',
        className,
      )}
    >
      {header != null && <div className="airo-surfaces-canvas__header">{header}</div>}
      <div className="airo-surfaces-canvas__body">
        <div
          ref={scrollRef}
          className={classnames(
            'airo-surfaces-canvas__scroll',
            fadeOnScroll && topFaded && 'airo-surfaces-canvas__scroll--faded-top',
            fadeOnScroll && bottomFaded && 'airo-surfaces-canvas__scroll--faded-bottom',
          )}
        >
          {children}
        </div>
        {status != null && (
          // Status slot is a sibling of `__scroll`, positioned absolute
          // against the body. Keeping it outside `__scroll` is what lets
          // the gradient mask paint over the scrolling content without
          // dimming the status pill — the mask is scoped to `__scroll`'s
          // box, not the body's. Logical-property positioning so the chip
          // anchors correctly under RTL.
          <div className="airo-surfaces-canvas__status-slot">{status}</div>
        )}
      </div>
    </section>
  );
});

CanvasRoot.displayName = 'Canvas';

/**
 * `Canvas` is a `<section>` surface that hosts AI-generated content alongside
 * the chat panel. It owns three slots — `header` (toolbar), `children`
 * (primary content), and `status` (a floating chip pinned top-center) — and
 * provides a themed, rounded chrome with a scrollable content region.
 *
 * Compound subparts:
 * - `Canvas.Status` — the floating status pill anchored top-center over the
 *   canvas's content area when passed via the `status` prop.
 *
 * @example Bare canvas
 * ```tsx
 * import { Canvas } from '@airo-ux/pattern-library/surfaces/canvas';
 * import '@airo-ux/pattern-library/surfaces/canvas/styles';
 *
 * <Canvas aria-label="Site preview">
 *   <iframe src={previewUrl} />
 * </Canvas>
 * ```
 *
 * @example With header and floating status
 * ```tsx
 * <Canvas
 *   aria-label="Site preview"
 *   header={<DeviceSwitcher value={device} onChange={setDevice} />}
 *   status={isEditing ? <Canvas.Status label="Editing…" /> : null}
 * >
 *   <iframe src={previewUrl} />
 * </Canvas>
 * ```
 */
export const Canvas = Object.assign(CanvasRoot, {
  Status: CanvasStatus,
});
