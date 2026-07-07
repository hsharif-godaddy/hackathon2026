import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  FLOATING_TOOLTIP_Z_INDEX,
  injectTooltipStyles,
  TOOLTIP_EXIT_FALLBACK_BUFFER_MS,
  TOOLTIP_EXIT_MS,
} from "./tooltipStyles";

const GAP = 8;
const VIEWPORT_MARGIN = 8;

const DEV_TOOLS_ROOT_ID = "airo-dev-tools-injected";

// Portal into the dev-tools root, not document.body. The dev-tools root has
// z-index 2147483647 (max), so a body-level bubble at 10001 always loses; only
// inside the root does its 10001 stack above the HoverBar's 10000.
function getTooltipPortalTarget(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(DEV_TOOLS_ROOT_ID) ?? document.body;
}

injectTooltipStyles();

/** Drop native `title` so the browser's delayed tooltip cannot stack under ours. */
function suppressNativeTitle(child: ReactNode, stripTitle: boolean): ReactNode {
  if (!stripTitle || !isValidElement(child)) {
    return child;
  }

  if ((child.props as { title?: string }).title === undefined) {
    return child;
  }

  return cloneElement(child as ReactElement<{ title?: string }>, { title: undefined });
}

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  delayMs?: number
  hideDelayMs?: number
  disabled?: boolean
}

export function Tooltip({
  content,
  children,
  delayMs = 0,
  hideDelayMs = 0,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [coords, setCoords] = useState<{ top: number, left: number, arrowOffsetPx: number } | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  const triggerRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    openRef.current = open;
  });

  const showBubble = open || exiting;
  const bubbleVisible = showBubble && !disabled;

  useLayoutEffect(function positionTooltip() {
    if (!bubbleVisible) {
      setCoords(null);
      return;
    }

    let cancelled = false;
    let observer: ResizeObserver | undefined;

    const update = function update() {
      if (cancelled) return;
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const triggerCenterX = rect.left + rect.width / 2;
      const top = rect.top - GAP;
      let left = triggerCenterX;
      let arrowOffsetPx = 0;

      const bubbleEl = bubbleRef.current;
      if (bubbleEl?.offsetWidth) {
        const half = bubbleEl.offsetWidth / 2;
        const minCenter = VIEWPORT_MARGIN + half;
        const maxCenter = window.innerWidth - VIEWPORT_MARGIN - half;
        left = Math.min(maxCenter, Math.max(minCenter, triggerCenterX));
        arrowOffsetPx = triggerCenterX - left + half;
      }

      setCoords((prev) => {
        const next = { left, top, arrowOffsetPx };
        if (
          prev
          && prev.left === next.left
          && prev.top === next.top
          && prev.arrowOffsetPx === next.arrowOffsetPx
        ) {
          return prev;
        }
        return next;
      });
    };

    const observeBubble = function observeBubble() {
      if (cancelled) return;
      const bubbleEl = bubbleRef.current;
      if (!bubbleEl || observer) return;
      observer = new ResizeObserver(update);
      observer.observe(bubbleEl);
    };

    update();
    queueMicrotask(function remeasureAfterMount() {
      update();
      observeBubble();
    });

    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [bubbleVisible, content]);

  useEffect(function cleanupTimeouts() {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      if (exitFallbackRef.current) clearTimeout(exitFallbackRef.current);
    };
  }, []);

  const clearExitFallback = function clearExitFallback() {
    if (exitFallbackRef.current) {
      clearTimeout(exitFallbackRef.current);
      exitFallbackRef.current = null;
    }
  };

  const handleBubbleAnimationEnd = function handleBubbleAnimationEnd(e: React.AnimationEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    clearExitFallback();
    setExiting(false);
  };

  const handleTriggerShow = function handleTriggerShow() {
    if (disabled) return;
    clearExitFallback();
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    if (exiting) {
      setExiting(false);
      setOpen(true);
      return;
    }
    showTimeoutRef.current = setTimeout(() => {
      showTimeoutRef.current = null;
      setOpen(true);
    }, delayMs);
  };

  const handleTriggerHide = function handleTriggerHide() {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    hideTimeoutRef.current = setTimeout(() => {
      hideTimeoutRef.current = null;
      clearExitFallback();
      const wasOpen = openRef.current;
      setOpen(false);
      if (!wasOpen) return;

      const reduceMotion
        = typeof window !== "undefined"
          && typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        setExiting(false);
        return;
      }

      setExiting(true);
      exitFallbackRef.current = setTimeout(() => {
        exitFallbackRef.current = null;
        setExiting(false);
      }, TOOLTIP_EXIT_MS + TOOLTIP_EXIT_FALLBACK_BUFFER_MS);
    }, hideDelayMs);
  };

  const handleContainerBlur = function handleContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    handleTriggerHide();
  };

  const handlePointerDown = function handlePointerDown() {
    clearExitFallback();
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setOpen(false);
    setExiting(false);
  };

  const portalTarget = bubbleVisible ? getTooltipPortalTarget() : null;
  const bubble = bubbleVisible && coords && portalTarget && (
    <div
      ref={bubbleRef}
      className="airo-tooltip-bubble"
      data-exiting={exiting || undefined}
      style={{
        left: coords.left,
        top: coords.top,
        zIndex: FLOATING_TOOLTIP_Z_INDEX,
        ...(coords.arrowOffsetPx > 0
          ? { ["--airo-tooltip-arrow-left" as string]: `${coords.arrowOffsetPx}px` }
          : {}),
      }}
      onAnimationEnd={handleBubbleAnimationEnd}
    >
      {content}
      <div className="airo-tooltip-arrow" />
    </div>
  );

  return (
    <div
      ref={triggerRef}
      className="airo-tooltip-root"
      onMouseEnter={handleTriggerShow}
      onMouseLeave={handleTriggerHide}
      onFocus={handleTriggerShow}
      onBlur={handleContainerBlur}
      onPointerDown={handlePointerDown}
    >
      {suppressNativeTitle(children, !disabled)}
      {bubble && portalTarget && createPortal(bubble, portalTarget)}
    </div>
  );
}
