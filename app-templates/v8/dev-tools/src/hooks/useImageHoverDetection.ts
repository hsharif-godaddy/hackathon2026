import { useEffect, useState, useCallback, useRef } from "react";
import { isDevToolsElement, isContentElement, detectImage, getMediaSlotPath } from "../utils/element-detection";

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

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || isDevToolsElement(target)) return;

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
        "span", "a", "button", "label", "li", "blockquote", "code", "pre", "figcaption"].includes(tag);
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
        showBarTimerRef.current = setTimeout(() => {
          showBarTimerRef.current = null;
          updateHoveredImage(null);
          updateHoveredElement({ type: "content", element: target });
        }, 150);
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
          showBarTimerRef.current = setTimeout(() => {
            showBarTimerRef.current = null;
            updateHoveredImage(null); // Clear image state
            updateHoveredElement({ type: "content", element: target });
          }, 150); // Shorter delay for content elements
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
      showBarTimerRef.current = setTimeout(() => {
        showBarTimerRef.current = null;
        updateHoveredImage({
          element: imgElement,
          imageUrl: imageInfo.imageUrl!,
          isMediaSlot: slotPath !== null,
          slotPath,
        });
      }, SHOW_DELAY_MS);
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

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
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
