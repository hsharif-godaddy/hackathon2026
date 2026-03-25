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
  const showBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isEditModeActive) return;

    const SHOW_DELAY_MS = 400;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || isDevToolsElement(target)) return;

      if (editingStateRef.current?.editingElement?.contains(target)) return;

      const imageInfo = detectImage(target);
      if (!imageInfo.isImage || !imageInfo.imageUrl) {
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

      if (showBarTimerRef.current) {
        clearTimeout(showBarTimerRef.current);
      }

      const slotPath = getMediaSlotPath(imageInfo.imageUrl);
      const imgElement = imageInfo.imageElement!;
      showBarTimerRef.current = setTimeout(() => {
        showBarTimerRef.current = null;
        setHoveredImage({
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

      if (showBarTimerRef.current) {
        clearTimeout(showBarTimerRef.current);
        showBarTimerRef.current = null;
      }

      hideBarTimerRef.current = setTimeout(() => {
        setHoveredImage(null);
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
  }, [isEditModeActive, editingStateRef]);

  const handleBarMouseEnter = useCallback(() => {
    if (hideBarTimerRef.current) {
      clearTimeout(hideBarTimerRef.current);
      hideBarTimerRef.current = null;
    }
  }, []);

  const handleBarMouseLeave = useCallback(() => {
    hideBarTimerRef.current = setTimeout(() => {
      setHoveredImage(null);
    }, 300);
  }, []);

  return {
    hoveredImage,
    handleBarMouseEnter,
    handleBarMouseLeave,
  };
}
