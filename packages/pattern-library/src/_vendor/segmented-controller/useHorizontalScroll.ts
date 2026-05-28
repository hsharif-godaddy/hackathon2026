// Temporary vendor: starting point is a copy of antares' internal hook.
// https://github.com/godaddy/antares/pull/187
//
// Upstream source: packages/@godaddy/antares/components/segmented-controller/src/use-horizontal-scroll.ts
//
// Not exposed by @godaddy/antares' public surface, so it has to be vendored
// alongside SegmentedController. Delete with the rest of this folder when
// PR #187 ships in @godaddy/antares.
//
// Behavioral divergences from upstream (catalogued in ./README.md > "Local
// divergences from upstream"): ResizeObserver feature-detect guard;
// `setState` referential-equality bailout in `update()` so scroll events
// don't churn React state every animation frame.
import { useCallback, useEffect, useRef, useState } from 'react';

type UseHorizontalScrollProps = {
  /** Whether the layout is right-to-left. */
  isRTL?: boolean;

  /** The number of pixels to scroll on each navigation action. @default 200 */
  scrollStep?: number;
};

/**
 * A hook to handle horizontal scrolling of a container.
 *
 * @param props - {@link UseHorizontalScrollProps}.
 * @returns An object containing refs, scroll state, and scroll handlers.
 */
export function useHorizontalScroll(props: UseHorizontalScrollProps) {
  const { isRTL = false, scrollStep = 200 } = props ?? {};
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollButtonsRef = useRef<HTMLDivElement | null>(null);

  const [state, setState] = useState({
    hasOverflow: false,
    canScrollPrev: false,
    canScrollNext: false,
  });

  //
  // Updates the scroll state when the container or scroll buttons change.
  // Determines if the scroll buttons should be shown.
  //
  const update = useCallback(function update() {
    const el = containerRef.current;
    if (!el) return;

    const scrollButtonsWidth = scrollButtonsRef.current?.clientWidth ?? 0;

    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);

    const hasOverflow = max - scrollButtonsWidth > 0;
    const canScrollPrev = pos > 1;
    const canScrollNext = pos < max - 1;

    // Functional updater + value compare bails the re-render when nothing
    // changed. Scroll events fire on every animation frame during a swipe;
    // without this guard each tick allocates a fresh object, defeating
    // React's `Object.is` bailout and re-rendering the controller on every
    // pixel of scroll. Local divergence from upstream antares — see the
    // file header for the full list.
    setState((prev) =>
      prev.hasOverflow === hasOverflow &&
      prev.canScrollPrev === canScrollPrev &&
      prev.canScrollNext === canScrollNext
        ? prev
        : { hasOverflow, canScrollPrev, canScrollNext },
    );
  }, []);

  //
  // Sets up a ResizeObserver and a scroll event listener to update
  // the scroll state when the container changes size or scrolls.
  //
  useEffect(
    function handleResizeObserver() {
      const el = containerRef.current;
      if (!el) return;

      el.addEventListener('scroll', update, { passive: true });
      update();

      // Older browsers / constrained webviews may lack ResizeObserver.
      // Fall back to scroll-driven updates only — matches the guard used
      // elsewhere in this repo (e.g. PanelChrome.tsx).
      if (typeof ResizeObserver === 'undefined') {
        return function unmountWithoutObserver() {
          el.removeEventListener('scroll', update);
        };
      }

      const ro = new ResizeObserver(update);
      ro.observe(el);

      return function unmount() {
        ro.disconnect();
        el.removeEventListener('scroll', update);
      };
    },
    [update],
  );

  const scrollPrev = useCallback(
    function handleScrollPrev() {
      // Honor `prefers-reduced-motion` per WCAG 2.3.3.
      containerRef.current?.scrollBy({
        top: 0,
        left: isRTL ? scrollStep : -scrollStep,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    },
    [isRTL, scrollStep],
  );

  const scrollNext = useCallback(
    function handleScrollNext() {
      // Honor `prefers-reduced-motion` per WCAG 2.3.3.
      containerRef.current?.scrollBy({
        top: 0,
        left: isRTL ? -scrollStep : scrollStep,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    },
    [isRTL, scrollStep],
  );

  return {
    containerRef,
    scrollButtonsRef,
    ...state,
    scrollPrev,
    scrollNext,
  };
}

/**
 * Returns true when the user has the `prefers-reduced-motion: reduce`
 * media query set. Used to swap `scrollIntoView` / `scrollBy` to
 * `behavior: 'auto'` (instant) when smooth scroll would trigger
 * vestibular issues.
 *
 * SSR-safe: returns `false` when `window` / `matchMedia` are absent.
 *
 * Local divergence from upstream antares — see file header.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
