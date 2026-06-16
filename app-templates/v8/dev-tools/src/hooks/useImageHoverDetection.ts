import { useEffect, useState, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { isDevToolsElement, isContentElement, detectImage, getMediaSlotPath, isInsideNavSurface } from "../utils/element-detection";
import { isTouchDevice } from "../utils/device";

export interface HoveredImage {
  element: HTMLElement;
  imageUrl: string;
  isMediaSlot: boolean;
  slotPath: string | null;
  isVideo: boolean;
}

export type HoveredElement =
  | { type: "image"; element: HTMLElement; imageUrl: string; isMediaSlot: boolean; slotPath: string | null; isVideo: boolean }
  | { type: "content"; element: HTMLElement };

const INLINE_DEFER_TAGS = ["span", "em", "strong", "b", "i", "code"];
const ABSORBER_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, label, a, button, pre";
const DIRECT_CONTENT_TAGS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "span", "a", "button", "label", "li", "blockquote", "code", "pre", "figcaption",
  "ul", "ol",
];
const DIRECT_IMAGE_TAGS = ["img", "video", "picture", "canvas", "svg"];

function deferToAbsorber(el: HTMLElement): HTMLElement {
  const tag = el.tagName.toLowerCase();
  if (!INLINE_DEFER_TAGS.includes(tag)) return el;
  const absorber = el.closest(ABSORBER_SELECTOR);
  if (!absorber || absorber === el) return el;
  return absorber as HTMLElement;
}

function resolveHoverableAnchor(target: HTMLElement): HoveredElement | null {
  if (isDevToolsElement(target)) return null;

  const tag = target.tagName.toLowerCase();
  const isDirectContentTag = DIRECT_CONTENT_TAGS.includes(tag);
  const isDirectImageTag = DIRECT_IMAGE_TAGS.includes(tag);

  // Anchor content before image detection so headings on top of hero images aren't claimed as the image.
  if (isDirectContentTag && !isDirectImageTag && isContentElement(target)) {
    return { type: "content", element: deferToAbsorber(target) };
  }

  let imageInfo = detectImage(target);
  if (!imageInfo.isImage) {
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== document.body) {
      const ancestorInfo = detectImage(ancestor);
      if (ancestorInfo.isImage && ancestorInfo.type === "background") {
        imageInfo = ancestorInfo;
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }

  if (imageInfo.isImage && imageInfo.imageUrl && imageInfo.imageElement) {
    const slotPath = getMediaSlotPath(imageInfo.imageUrl);
    return {
      type: "image",
      element: imageInfo.imageElement,
      imageUrl: imageInfo.imageUrl,
      isMediaSlot: slotPath !== null,
      slotPath,
      isVideo: imageInfo.isVideo,
    };
  }

  if (tag !== "body" && tag !== "html" && isContentElement(target)) {
    return { type: "content", element: deferToAbsorber(target) };
  }

  return null;
}

function pointerLeftDocument(relatedTarget: EventTarget | null): boolean {
  if (!relatedTarget || !(relatedTarget instanceof Node)) {
    return true;
  }
  return !document.documentElement.contains(relatedTarget);
}

/**
 * Hook for detecting when the user hovers over an image element.
 * Provides the hovered image state and mouse handlers for the ImageHoverBar.
 */
export function useImageHoverDetection(
  isEditModeActive: boolean,
  editingStateRef: React.RefObject<{ editingElement: HTMLElement | null; saveStatus?: string }>,
) {
  const [hoveredImage, setHoveredImage] = useState<HoveredImage | null>(null);
  const [hoveredElement, setHoveredElement] = useState<HoveredElement | null>(null);
  // toolbarMode lives here (not in ElementHoverBar) so that a click can update
  // hoveredElement and toolbarMode atomically inside one flushSync — making
  // first-click bar appearance deterministic regardless of hover-timer races.
  const [toolbarMode, setToolbarModeState] = useState(false);
  const toolbarModeRef = useRef(false);
  const hoveredImageRef = useRef<HoveredImage | null>(null);
  const hoveredElementRef = useRef<HoveredElement | null>(null);
  const showBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref must update in the same tick as state — not in useEffect (runs after paint)
  // or even useLayoutEffect (still after the setState call returns). Event handlers
  // and flushSync commits read toolbarModeRef immediately after setToolbarMode.
  const setToolbarMode = useCallback((value: boolean) => {
    toolbarModeRef.current = value;
    setToolbarModeState(value);
  }, []);

  const updateHoveredElement = useCallback((value: HoveredElement | null) => {
    hoveredElementRef.current = value;
    setHoveredElement(value);
  }, []);

  // Keep ref in sync with state so event handlers (closures) see current value
  const updateHoveredImage = useCallback((value: HoveredImage | null) => {
    hoveredImageRef.current = value;
    setHoveredImage(value);
    // Also update unified state
    if (value) {
      updateHoveredElement({ type: "image", ...value });
    } else {
      updateHoveredElement(null);
    }
  }, []);

  const clearToolbarAnchor = useCallback(() => {
    if (hideBarTimerRef.current) {
      clearTimeout(hideBarTimerRef.current);
      hideBarTimerRef.current = null;
    }
    if (showBarTimerRef.current) {
      clearTimeout(showBarTimerRef.current);
      showBarTimerRef.current = null;
    }
    updateHoveredImage(null);
    setToolbarMode(false);
  }, [updateHoveredImage, setToolbarMode]);

  useEffect(() => {
    if (!isEditModeActive) return;

    const SHOW_DELAY_MS = 400;
    const isMobile = isTouchDevice();

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || isDevToolsElement(target)) {
        // Cancel any pending hover commit so it doesn't fire while the user is on the bar.
        if (showBarTimerRef.current) {
          clearTimeout(showBarTimerRef.current);
          showBarTimerRef.current = null;
        }
        return;
      }
      if (isInsideNavSurface(target)) {
        // Nav links navigate; never show hover bar for them
        if (showBarTimerRef.current) {
          clearTimeout(showBarTimerRef.current);
          showBarTimerRef.current = null;
        }
        return;
      }

      if (editingStateRef.current?.editingElement?.contains(target)) return;

      // Toolbar is click-anchored; ignore hover retargeting while it is open so
      // moving toward the bar over a nearby element does not steal the toolbar.
      if (toolbarModeRef.current) return;

      // If we're already tracking an element, handle bubbling:
      const tracked = hoveredElementRef.current?.element;
      if (tracked) {
        // Target is the tracked element or a child of it — keep state
        if (tracked === target || tracked.contains(target)) {
          if (hideBarTimerRef.current) { clearTimeout(hideBarTimerRef.current); hideBarTimerRef.current = null; }
          return;
        }
        // Target is a parent/ancestor of tracked element — cancel any pending
        // hide timer (mouse is still within the content hierarchy) and keep state.
        if (target.contains(tracked)) {
          if (hideBarTimerRef.current) { clearTimeout(hideBarTimerRef.current); hideBarTimerRef.current = null; }
          return;
        }
      }

      const anchor = resolveHoverableAnchor(target);

      if (!anchor) {
        // If the bar is already showing and the mouse is still within the
        // hovered element's bounding rect, keep it visible.
        if (hoveredElementRef.current) {
          const rect = hoveredElementRef.current.element.getBoundingClientRect();
          if (
            e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom
          ) {
            if (hideBarTimerRef.current) {
              clearTimeout(hideBarTimerRef.current);
              hideBarTimerRef.current = null;
            }
            return;
          }
        }

        if (showBarTimerRef.current) {
          clearTimeout(showBarTimerRef.current);
          showBarTimerRef.current = null;
        }
        // Debounce the null to prevent flicker when the mouse briefly crosses
        // non-content wrapper elements between content elements.
        if (!hideBarTimerRef.current) {
          hideBarTimerRef.current = setTimeout(() => {
            hideBarTimerRef.current = null;
            updateHoveredImage(null);
          }, 200);
        }
        return;
      }

      if (anchor.type === "content") {
        if (hideBarTimerRef.current) { clearTimeout(hideBarTimerRef.current); hideBarTimerRef.current = null; }
        if (hoveredElementRef.current?.element === anchor.element) return;
        if (showBarTimerRef.current) clearTimeout(showBarTimerRef.current);
        // Update ref immediately so mouseout bounds check uses this element
        hoveredElementRef.current = anchor;
        hoveredImageRef.current = null;
        const delay = isMobile ? 0 : 150;
        showBarTimerRef.current = setTimeout(() => {
          showBarTimerRef.current = null;
          updateHoveredImage(null);
          updateHoveredElement(anchor);
          // Hover-driven element change: bar must wait for an explicit click.
          setToolbarMode(false);
        }, delay);
        return;
      }

      if (hideBarTimerRef.current) { clearTimeout(hideBarTimerRef.current); hideBarTimerRef.current = null; }
      if (hoveredImageRef.current?.element === anchor.element) return;
      if (showBarTimerRef.current) clearTimeout(showBarTimerRef.current);
      const delay = isMobile ? 0 : SHOW_DELAY_MS;
      showBarTimerRef.current = setTimeout(() => {
        showBarTimerRef.current = null;
        updateHoveredImage({
          element: anchor.element,
          imageUrl: anchor.imageUrl,
          isMediaSlot: anchor.isMediaSlot,
          slotPath: anchor.slotPath,
          isVideo: anchor.isVideo,
        });
        // Hover shows outline only; toolbar opens on click.
        setToolbarMode(false);
      }, delay);
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (toolbarModeRef.current) {
        // Keep the bar open for in-document moves (e.g. toward the toolbar over a
        // neighbor element), but dismiss when the pointer leaves the document
        // (iframe edge, tab switch without bar mouseleave, etc.).
        if (pointerLeftDocument(e.relatedTarget)) {
          clearToolbarAnchor();
        }
        return;
      }

      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget?.closest(".edit-mode-hover-bar")) return;
      if (relatedTarget?.closest(".edit-mode-link-follow-bar")) return;

      // If the mouse is still within the hovered element's bounds, keep the bar.
      const currentEl = hoveredElementRef.current?.element ?? hoveredImageRef.current?.element;
      if (currentEl && e.clientX && e.clientY) {
        const rect = currentEl.getBoundingClientRect();
        if (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        ) {
          return;
        }
      }

      // If the related target is a child of the current element, keep the bar
      if (currentEl && relatedTarget && currentEl.contains(relatedTarget)) {
        return;
      }

      if (showBarTimerRef.current) {
        clearTimeout(showBarTimerRef.current);
        showBarTimerRef.current = null;
      }

      hideBarTimerRef.current = setTimeout(() => {
        updateHoveredImage(null);
      }, 300);
    };

    // Hover state lags refs by a 150ms flicker-guard timer. flushSync in
    // capture phase commits the pending state before the click reaches
    // ElementHoverBar's closure, which would otherwise see stale props.
    const handleMouseDown = (e: MouseEvent) => {
      if (!showBarTimerRef.current) return;
      const target = e.target as HTMLElement | null;
      if (!target || isDevToolsElement(target)) return;

      clearTimeout(showBarTimerRef.current);
      showBarTimerRef.current = null;

      const elemRefValue = hoveredElementRef.current;
      const imgRefValue = hoveredImageRef.current;
      if (!elemRefValue && !imgRefValue) return;

      flushSync(() => {
        if (imgRefValue) {
          updateHoveredImage(imgRefValue);
        } else if (elemRefValue) {
          updateHoveredElement(elemRefValue);
        }
      });
    };

    // Click is the source of truth for opening the bar. Registered after
    // useTextEditing's capture handler so text edit claims the event first;
    // bail during in-flight save to preserve the optimistic overlay.
    const handleClick = (e: MouseEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      if (!rawTarget) return;
      if (isDevToolsElement(rawTarget)) return;
      if (editingStateRef.current?.saveStatus === "saving") return;
      // Nav links pass through to native navigation — mirror the hover and
      // useTextEditing-click bails so a click on a nav link doesn't open the
      // bar over the link before (or instead of) the route change.
      if (isInsideNavSurface(rawTarget)) return;

      let anchor = resolveHoverableAnchor(rawTarget);
      if (!anchor) {
        // Click-only fallback: wrappers don't get continuous pointer events to land on a content child.
        let current: HTMLElement | null = rawTarget.parentElement;
        while (current && current !== document.body) {
          const t = current.tagName.toLowerCase();
          if (t !== "body" && t !== "html" && isContentElement(current)) {
            anchor = { type: "content", element: current };
            break;
          }
          current = current.parentElement;
        }
      }
      if (!anchor) return;

      if (showBarTimerRef.current) {
        clearTimeout(showBarTimerRef.current);
        showBarTimerRef.current = null;
      }
      if (hideBarTimerRef.current) {
        clearTimeout(hideBarTimerRef.current);
        hideBarTimerRef.current = null;
      }

      // flushSync so React commits hoveredElement + toolbarMode together
      // before any subsequent events fire — ElementHoverBar mounts with the
      // correct element prop and toolbarMode=true in a single layout pass.
      flushSync(() => {
        if (anchor.type === "image") {
          updateHoveredImage({
            element: anchor.element,
            imageUrl: anchor.imageUrl,
            isMediaSlot: anchor.isMediaSlot,
            slotPath: anchor.slotPath,
            isVideo: anchor.isVideo,
          });
        } else {
          updateHoveredImage(null);
          updateHoveredElement(anchor);
        }
        setToolbarMode(true);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && toolbarModeRef.current) {
        clearToolbarAnchor();
      }
    };

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (showBarTimerRef.current) clearTimeout(showBarTimerRef.current);
      if (hideBarTimerRef.current) clearTimeout(hideBarTimerRef.current);
    };
  }, [isEditModeActive, editingStateRef, updateHoveredImage, updateHoveredElement, setToolbarMode, clearToolbarAnchor]);

  const handleBarMouseEnter = useCallback(() => {
    if (hideBarTimerRef.current) {
      clearTimeout(hideBarTimerRef.current);
      hideBarTimerRef.current = null;
    }
  }, []);

  const handleBarMouseLeave = useCallback(() => {
    hideBarTimerRef.current = setTimeout(clearToolbarAnchor, 300);
  }, [clearToolbarAnchor]);

  return {
    hoveredImage,
    hoveredElement,
    toolbarMode,
    setToolbarMode,
    handleBarMouseEnter,
    handleBarMouseLeave,
  };
}
