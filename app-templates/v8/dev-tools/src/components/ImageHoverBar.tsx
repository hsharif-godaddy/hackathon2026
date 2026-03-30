import React, { useCallback } from "react";
import { safePostMessage } from "../utils/postMessage";
import { generatePreciseSelector, extractDevContext } from "../utils/element-helpers";
import { showSelectionOverlay } from "../utils/selection-overlay";
import type { HoveredImage } from "../hooks/useImageHoverDetection";
import { Image, Sparkles } from "lucide-react";
import { t } from "../utils/translations";

interface ImageHoverBarProps {
  hoveredImage: HoveredImage;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export default function ImageHoverBar({
  hoveredImage,
  onMouseEnter,
  onMouseLeave,
}: ImageHoverBarProps) {
  const { element, imageUrl, isMediaSlot, slotPath } = hoveredImage;

  const rect = element.getBoundingClientRect();

  const barStyle: React.CSSProperties = {
    position: "fixed",
    bottom: `${window.innerHeight - rect.bottom + 16}px`,
    right: `${window.innerWidth - rect.right + 8}px`,
  };

  const handleReplace = useCallback(() => {
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
  }, [element, imageUrl, isMediaSlot, slotPath]);

  const handleEditWithAI = useCallback(() => {
    showSelectionOverlay(element);
    const elRect = element.getBoundingClientRect();

    const devContext = extractDevContext(element);
    const preciseSelector = generatePreciseSelector(element);

    safePostMessage(window.parent, {
      type: "EDIT_WITH_AI",
      data: {
        elementInfo: {
          tagName: element.tagName.toLowerCase(),
          className: element.className,
          id: element.id,
          textContent: "",
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
        imageInfo: {
          type: element.tagName.toLowerCase() === "img" ? "img" : "background",
          currentUrl: imageUrl,
        },
      },
    });
  }, [element, imageUrl]);

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
