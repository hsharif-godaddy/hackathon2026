import React, { useCallback, useEffect } from "react";
import { safePostMessage } from "../utils/postMessage";
import { generatePreciseSelector, extractDevContext } from "../utils/element-helpers";
import { showSelectionOverlay } from "../utils/selection-overlay";
import { addNumberedOverlay, removeNumberedOverlay, getNextSelectionNumber } from "../utils/selection-overlay";
import type { HoveredElement } from "../hooks/useImageHoverDetection";
import { Image, Sparkles } from "lucide-react";
import { t } from "../utils/translations";

interface ElementHoverBarProps {
  hoveredElement: HoveredElement;
  isMultiSelectActive: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}


export default function ElementHoverBar({
  hoveredElement,
  isMultiSelectActive,
  onMouseEnter,
  onMouseLeave,
}: ElementHoverBarProps) {
  const { element } = hoveredElement;
  const isImage = hoveredElement.type === "image";

  // Show a subtle outline on the hovered element
  useEffect(() => {
    element.style.outline = "2px solid rgba(139,92,246,0.4)";
    element.style.outlineOffset = "2px";
    return () => {
      element.style.outline = "";
      element.style.outlineOffset = "";
    };
  }, [element]);

  const rect = element.getBoundingClientRect();

  // Images: bottom-right corner above the image (existing behavior)
  // Content: bottom-right corner, snug to the element
  const barStyle: React.CSSProperties = isImage
    ? {
        position: "fixed",
        bottom: `${window.innerHeight - rect.bottom + 16}px`,
        right: `${window.innerWidth - rect.right + 8}px`,
      }
    : {
        position: "fixed",
        top: `${rect.bottom - 13}px`,
        left: `${rect.right - 13}px`,
      };

  const handleReplace = useCallback(() => {
    if (hoveredElement.type !== "image") return;
    const { imageUrl, isMediaSlot, slotPath } = hoveredElement;

    if (isMediaSlot && slotPath) {
      safePostMessage(window.parent, {
        type: "OPEN_MEDIA_SLOT_DIALOG",
        slotName: slotPath,
      });
    } else {
      const devContext = extractDevContext(element);
      const imgEl = element.tagName.toLowerCase() === "img" ? (element as HTMLImageElement) : null;
      safePostMessage(window.parent, {
        type: "AUTO_IMPORT_MEDIA_SLOT",
        imageUrl,
        devContext,
        imageType: imgEl ? "img" : "background",
        imageAlt: imgEl?.alt || "",
      });
    }
  }, [element, hoveredElement]);

  const handleEditWithAI = useCallback(() => {
    const elRect = element.getBoundingClientRect();
    const devContext = extractDevContext(element);
    const preciseSelector = generatePreciseSelector(element);

    let selectionNumber: number | undefined;
    if (isMultiSelectActive) {
      if (element.hasAttribute("data-ai-selected-num")) return;
      selectionNumber = getNextSelectionNumber();
      const num = selectionNumber;
      addNumberedOverlay(element, num, () => {
        removeNumberedOverlay(num);
        safePostMessage(window.parent, { type: "REMOVE_SELECTION_FROM_PREVIEW", data: { number: num } });
      });
    } else {
      showSelectionOverlay(element);
    }

    const data: Record<string, unknown> = {
      elementInfo: {
        tagName: element.tagName.toLowerCase(),
        className: element.className,
        id: element.id,
        textContent: isImage ? "" : (element.textContent || "").substring(0, 500),
        computedStyles: {},
        rect: {
          top: elRect.top,
          left: elRect.left,
          width: elRect.width,
          height: elRect.height,
        },
        selector: preciseSelector,
        preciseSelector,
        devContext,
      },
      selector: preciseSelector,
      devContext,
      selectionNumber,
    };

    // Add image info if this is an image element
    if (hoveredElement.type === "image") {
      data.imageInfo = {
        type: element.tagName.toLowerCase() === "img" ? "img" : "background",
        currentUrl: hoveredElement.imageUrl,
      };
    }

    safePostMessage(window.parent, {
      type: "EDIT_WITH_AI",
      data,
    });
  }, [element, isMultiSelectActive, isImage, hoveredElement]);

  return (
    <div
      data-airo-dev-tools
      className="edit-mode-hover-bar"
      style={{
        ...barStyle,
        display: "flex",
        gap: "4px",
        background: "rgba(255, 255, 255, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        padding: "4px",
        borderRadius: "10px",
        boxShadow:
          "0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.2)",
        zIndex: 10000,
        pointerEvents: "auto",
        fontFamily: "system-ui, sans-serif",
        animation: "editBarFadeIn 0.15s ease-out",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isImage && (
        <button
          type="button"
          onClick={handleReplace}
          title={t("devtools_image_replace_title", "Replace image")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            padding: "6px 10px",
            background: "rgba(255, 255, 255, 0.9)",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--color-text-secondary)",
            letterSpacing: "-0.01em",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(245, 245, 245, 0.95)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.9)";
          }}
        >
          <Image style={{ width: "15px", height: "15px" }} />
          {t("devtools_image_replace", "Replace")}
        </button>
      )}

      <button
        type="button"
        onClick={handleEditWithAI}
        title={t("devtools_edit_with_ai", "Edit with AI")}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px",
          background: "rgba(255, 255, 255, 0.9)",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          color: "var(--color-text-secondary)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(245, 245, 245, 0.95)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.9)";
        }}
      >
        <Sparkles style={{ width: "15px", height: "15px", color: "var(--color-accent-purple)" }} />
      </button>
    </div>
  );
}
