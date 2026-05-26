import { useEffect, useState, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { isDevToolsElement, isContentElement, detectImage, getMediaSlotPath, isInsideNavSurface } from "../utils/element-detection";
import { isTouchDevice } from "../utils/device";

export interface HoveredImage {
  element: HTMLElement;
  imageUrl: string;
  isMediaSlot: boolean;
  slotPath: string | null;
}

export type HoveredElement =
  | { type: "image"; element: HTMLElement; imageUrl: string; isMediaSlot: boolean; slotPath: string | null }
  | { type: "content"; element: HTMLElement };

/**
 * Hook for detecting when the user hovers over an image element.
 * Provides the hovered image state and mouse handlers for the ImageHoverBar.
 */
export function useImageHoverDetection(
  isEditModeActive: boolean,
  editingStateRef: React.RefObject<{ editingElement: HTMLElement | null }>,
) {
  const [hoveredImage, setHoveredImage] = useState<HoveredImage | null>(null);
  const [hoveredElement, setHoveredElement] = useState<HoveredElement | null>(null);
  const hoveredImageRef = useRef<HoveredImage | null>(null);
  const hoveredElementRef = useRef<HoveredElement | null>(null);
  const showBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!isEditModeActive) return;

    const SHOW_DELAY_MS = 400;
    const isMobile = isTouchDevice();

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || isDevToolsElement(target)) return;
      if (isInsideNavSurface(target)) {
        // Nav links navigate; never show hover bar for them
        if (showBarTimerRef.current) {
          clearTimeout(showBarTimerRef.current);
          showBarTimerRef.current = null;
        }
        return;
      }

      if (editingStateRef.current?.editingElement?.contains(target)) return;

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

      // Check if the target is a direct content element (heading, paragraph, etc.)
      // BEFORE image detection, since image detection walks siblings/children
      // and might incorrectly claim a heading inside an image card.
      const tag = target.tagName.toLowerCase();
      const isDirectContentTag = ["p", "h1", "h2", "h3", "h4", "h5", "h6",
        "span", "a", "button", "label", "li", "blockquote", "code", "pre", "figcaption",
        "ul", "ol"].includes(tag);
      const directImageTag = tag === "img" || tag === "video" || tag === "picture" || tag === "canvas" || tag === "svg";

      // For direct content tags (not images), skip image detection and go straight to content path.
      // Content elements take priority over images they overlap (e.g. heading on top of hero image).
      if (isDirectContentTag && !directImageTag && isContentElement(target)) {
        if (hideBarTimerRef.current) { clearTimeout(hideBarTimerRef.current); hideBarTimerRef.current = null; }
        if (hoveredElementRef.current?.element === target) return;
        if (showBarTimerRef.current) clearTimeout(showBarTimerRef.current);
        // Update ref immediately so mouseout bounds check uses this element
        hoveredElementRef.current = { type: "content", element: target };
        hoveredImageRef.current = null;
        // On mobile, show immediately on tap (no delay); on desktop use delay for hover
        const delay = isMobile ? 0 : 150;
        showBarTimerRef.current = setTimeout(() => {
          showBarTimerRef.current = null;
          updateHoveredImage(null);
          updateHoveredElement({ type: "content", element: target });
        }, delay);
        return;
      }

      let imageInfo = detectImage(target);

      // If the direct target isn't an image, walk up ancestors to find a
      // parent with a background image. This handles overlaying elements
      // (SVGs, decorative divs with pointer-events) that sit on top of a
      // background-image container and intercept mouse events.
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

      if (!imageInfo.isImage || !imageInfo.imageUrl) {
        // If the bar is already showing and the mouse is still within the
        // hovered element's bounding rect, keep the bar visible.
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

        // Not an image — check if it's a content element (text, heading, link, etc.)
        const tag = target.tagName.toLowerCase();
        if (tag !== "body" && tag !== "html" && isContentElement(target)) {
          if (hideBarTimerRef.current) { clearTimeout(hideBarTimerRef.current); hideBarTimerRef.current = null; }
          if (hoveredElementRef.current?.element === target) return;
          if (showBarTimerRef.current) clearTimeout(showBarTimerRef.current);
          // On mobile, show immediately on tap (no delay); on desktop use delay for hover
          const delay = isMobile ? 0 : 150;
          showBarTimerRef.current = setTimeout(() => {
            showBarTimerRef.current = null;
            updateHoveredImage(null); // Clear image state
            updateHoveredElement({ type: "content", element: target });
          }, delay);
          return;
        }

        if (showBarTimerRef.current) {
          clearTimeout(showBarTimerRef.current);
          showBarTimerRef.current = null;
        }
        // Delay the null to prevent flicker when mouse briefly crosses
        // non-content wrapper elements between content elements.
        if (!hideBarTimerRef.current) {
          hideBarTimerRef.current = setTimeout(() => {
            hideBarTimerRef.current = null;
            updateHoveredImage(null);
          }, 200);
        }
        return;
      }

      if (hideBarTimerRef.current) {
        clearTimeout(hideBarTimerRef.current);
        hideBarTimerRef.current = null;
      }

      // If we're already showing the bar for this exact image element
      // (e.g., mouse moved between overlay siblings), skip the delay.
      const imgElement = imageInfo.imageElement!;
      if (hoveredImageRef.current?.element === imgElement) {
        return;
      }

      if (showBarTimerRef.current) {
        clearTimeout(showBarTimerRef.current);
      }

      const slotPath = getMediaSlotPath(imageInfo.imageUrl);
      // On mobile, show immediately on tap (no delay); on desktop use delay for hover
      const delay = isMobile ? 0 : SHOW_DELAY_MS;
      showBarTimerRef.current = setTimeout(() => {
        showBarTimerRef.current = null;
        updateHoveredImage({
          element: imgElement,
          imageUrl: imageInfo.imageUrl!,
          isMediaSlot: slotPath !== null,
          slotPath,
        });
      }, delay);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget?.closest(".edit-mode-hover-bar")) return;

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

    // The mouseover handler refs (`hoveredElementRef` / `hoveredImageRef`) are
    // updated synchronously, but the corresponding React state lags by a
    // SHOW_DELAY_MS / 150ms timer to avoid bar flicker on accidental hovers.
    // If the user clicks fast enough that mousedown fires before the timer,
    // ElementHoverBar's click handler — whose closure reads `element` from
    // props — sees a stale value and bails. Flush pending hover state
    // synchronously here so the click that follows lands on a re-rendered
    // ElementHoverBar with a fresh closure.
    //
    // Capture phase + flushSync (not the batched setState path): React's
    // automatic batching would defer the commit until after `click` had
    // already dispatched, which defeats the purpose. flushSync forces commit
    // + useLayoutEffect synchronously, so ElementHoverBar's click listener
    // (also useLayoutEffect) re-registers with the correct `element` before
    // the click event reaches it.
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

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("mousedown", handleMouseDown, true);
      if (showBarTimerRef.current) clearTimeout(showBarTimerRef.current);
      if (hideBarTimerRef.current) clearTimeout(hideBarTimerRef.current);
    };
  }, [isEditModeActive, editingStateRef, updateHoveredImage, updateHoveredElement]);

  const handleBarMouseEnter = useCallback(() => {
    if (hideBarTimerRef.current) {
      clearTimeout(hideBarTimerRef.current);
      hideBarTimerRef.current = null;
    }
  }, []);

  const handleBarMouseLeave = useCallback(() => {
    hideBarTimerRef.current = setTimeout(() => {
      updateHoveredImage(null);
      updateHoveredElement(null);
    }, 300);
  }, [updateHoveredImage, updateHoveredElement]);

  return {
    hoveredImage,
    hoveredElement,
    handleBarMouseEnter,
    handleBarMouseLeave,
  };
}
