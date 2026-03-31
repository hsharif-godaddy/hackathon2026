import { useEffect, useState, useCallback, useRef } from "react";
import { isDevToolsElement, detectImage, getMediaSlotPath } from "../utils/element-detection";

export interface HoveredImage {
  element: HTMLElement;
  imageUrl: string;
  isMediaSlot: boolean;
  slotPath: string | null;
}

/**
 * Hook for detecting when the user hovers over an image element.
 * Provides the hovered image state and mouse handlers for the ImageHoverBar.
 */
export function useImageHoverDetection(
  isEditModeActive: boolean,
  editingStateRef: React.RefObject<{ editingElement: HTMLElement | null }>,
) {
  const [hoveredImage, setHoveredImage] = useState<HoveredImage | null>(null);
  const hoveredImageRef = useRef<HoveredImage | null>(null);
  const showBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync with state so event handlers (closures) see current value
  const updateHoveredImage = useCallback((value: HoveredImage | null) => {
    hoveredImageRef.current = value;
    setHoveredImage(value);
  }, []);

  useEffect(() => {
    if (!isEditModeActive) return;

    const SHOW_DELAY_MS = 400;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || isDevToolsElement(target)) return;

      if (editingStateRef.current?.editingElement?.contains(target)) return;

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
        // image's bounding rect (e.g., hovering over text, buttons, or an SVG
        // divider that overlays the image), keep the bar visible.
        if (hoveredImageRef.current) {
          const rect = hoveredImageRef.current.element.getBoundingClientRect();
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

      // If the mouse is moving to an element that's still visually within the
      // hovered image's bounds (e.g., overlay gradient, SVG divider, hero text),
      // don't dismiss the bar. Use the mouseout event coordinates which reflect
      // where the mouse is heading.
      if (hoveredImageRef.current && e.clientX && e.clientY) {
        const rect = hoveredImageRef.current.element.getBoundingClientRect();
        if (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        ) {
          return;
        }
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
  }, [isEditModeActive, editingStateRef, updateHoveredImage]);

  const handleBarMouseEnter = useCallback(() => {
    if (hideBarTimerRef.current) {
      clearTimeout(hideBarTimerRef.current);
      hideBarTimerRef.current = null;
    }
  }, []);

  const handleBarMouseLeave = useCallback(() => {
    hideBarTimerRef.current = setTimeout(() => {
      updateHoveredImage(null);
    }, 300);
  }, [updateHoveredImage]);

  return {
    hoveredImage,
    handleBarMouseEnter,
    handleBarMouseLeave,
  };
}
