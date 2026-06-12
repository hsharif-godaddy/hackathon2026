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
  const [coords, setCoords] = useState<{ top: number, left: number } | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  const triggerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    openRef.current = open;
  });

  const showBubble = open || exiting;
  const bubbleVisible = showBubble && !disabled;

  useLayoutEffect(() => {
    if (!bubbleVisible) return;

    const updateCoords = function updateCoords() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        left: rect.left + rect.width / 2,
        top: rect.top - GAP,
      });
    };

    updateCoords();

    window.addEventListener("scroll", updateCoords, true);
    window.addEventListener("resize", updateCoords);

    return () => {
      window.removeEventListener("scroll", updateCoords, true);
      window.removeEventListener("resize", updateCoords);
    };
  }, [bubbleVisible]);

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
      className="airo-tooltip-bubble"
      data-exiting={exiting || undefined}
      style={{ left: coords.left, top: coords.top, zIndex: FLOATING_TOOLTIP_Z_INDEX }}
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
