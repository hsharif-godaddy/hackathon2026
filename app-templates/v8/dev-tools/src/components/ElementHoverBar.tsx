import React, { useCallback, useEffect, useRef, useState } from "react";
import { safePostMessage } from "../utils/postMessage";
import { generatePreciseSelector, extractDevContext, getElementClassName } from "../utils/element-helpers";
import { isTouchDevice } from "../utils/device";
import {
  showSelectionOverlay,
  addNumberedOverlay,
  removeNumberedOverlay,
  getNextSelectionNumber,
} from "../utils/selection-overlay";
import type { HoveredElement } from "../hooks/useImageHoverDetection";
import { Bold, Bookmark, Image, Italic, Pencil, Pointer, Sparkles } from "lucide-react";
import { isClickable } from "../utils/element-detection";
import { t } from "../utils/translations";
import { HoverBar, HoverBarButton } from "./HoverBar";
import { QuickEditBar } from "./QuickEditBar";

/** Tags eligible for bold/italic toggle (text-bearing inline/block elements). */
const TEXT_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "label", "li", "blockquote"]);

interface ElementHoverBarProps {
  hoveredElement: HoveredElement;
  isMultiSelectActive: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onQuickEditModeChange?: (active: boolean) => void;
}

export default function ElementHoverBar({
  hoveredElement,
  isMultiSelectActive,
  onMouseEnter,
  onMouseLeave,
  onQuickEditModeChange,
}: ElementHoverBarProps) {
  const { element } = hoveredElement;
  const isImage = hoveredElement.type === "image";
  const [toolbarMode, setToolbarMode] = useState(false);
  const [quickEditMode, setQuickEditMode] = useState(false);
  const [, forceRender] = useState(0);
  // Context built when Sparkles is clicked — sent only when Quick Edit is submitted
  const pendingContextRef = useRef<Record<string, unknown> | null>(null);
  // Capture the element reference when toolbar opens so actions use the correct element
  // even if hover moves away (e.g., mouse enters toolbar, causing parent to track a new hover)
  const toolbarElementRef = useRef<HTMLElement | null>(null);
  const toolbarHoveredElementRef = useRef<HoveredElement | null>(null);

  // Outline overlay + pointer cursor on the hovered element.
  // Uses a fixed-position div so the outline stays visible even when
  // useTextEditing hides the element (visibility:hidden) for Lexical editing.
  const outlineRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    element.style.cursor = "pointer";
    const overlay = document.createElement("div");
    overlay.setAttribute("data-airo-dev-tools", "");
    overlay.style.position = "fixed";
    overlay.style.border = "2px solid rgba(139,92,246,0.4)";
    overlay.style.borderRadius = "4px";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "9999";
    const updatePos = () => {
      const r = element.getBoundingClientRect();
      overlay.style.top = `${r.top - 2}px`;
      overlay.style.left = `${r.left - 2}px`;
      overlay.style.width = `${r.width + 4}px`;
      overlay.style.height = `${r.height + 4}px`;
    };
    updatePos();
    document.body.appendChild(overlay);
    outlineRef.current = overlay;
    // Update position on scroll/resize
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      overlay.remove();
      outlineRef.current = null;
      element.style.cursor = "";
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [element]);

  // Reset all modes when the hovered element changes
  useEffect(() => {
    setToolbarMode(false);
    setQuickEditMode(false);
    pendingContextRef.current = null;
  }, [element]);

  // Auto-open toolbar on mobile (skip the click requirement)
  useEffect(() => {
    if (isTouchDevice()) {
      // Small delay to let the component render first
      const timer = setTimeout(() => {
        toolbarElementRef.current = element;
        toolbarHoveredElementRef.current = hoveredElement;
        setToolbarMode(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [element, hoveredElement]);

  // Notify parent when toolbar or quick edit is active so it can freeze the element
  useEffect(() => {
    onQuickEditModeChange?.(toolbarMode || quickEditMode);
  }, [toolbarMode, quickEditMode, onQuickEditModeChange]);

  // Release the freeze when this component unmounts
  useEffect(() => {
    return () => onQuickEditModeChange?.(false);
  }, [onQuickEditModeChange]);

  // Clicking the element opens the toolbar.
  // Registered at document capture phase so it fires alongside useTextEditing's
  // capture handler — text editing still activates normally on the same click.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      // Ignore clicks inside dev-tools overlays (toolbar, Lexical editor, etc.)
      if (
        target.closest(".edit-mode-hover-bar") ||
        target.closest("[data-airo-dev-tools]") ||
        target.closest("[data-dev-tools]")
      ) return;
      // Only act when the click target is the tracked element or a descendant
      if (target !== element && !element.contains(target)) return;
      // Capture the element and hoveredElement at the moment the toolbar opens
      toolbarElementRef.current = element;
      toolbarHoveredElementRef.current = hoveredElement;
      setToolbarMode(true);
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [element, hoveredElement]);

  // Dismiss toolbar/quick edit when clicking outside the bar, the element, or editor overlays
  useEffect(() => {
    if (!toolbarMode && !quickEditMode) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".edit-mode-hover-bar")) return;
      if (element.contains(target)) return;
      if (target.closest("[data-dev-tools]") || target.closest("[data-airo-dev-tools]")) return;
      setToolbarMode(false);
      setQuickEditMode(false);
      pendingContextRef.current = null;
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [toolbarMode, quickEditMode, element]);

  // Track toolbar position, updating on scroll/resize so it follows the element
  const [barStyle, setBarStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    const computeBarStyle = (): React.CSSProperties => {
      const r = element.getBoundingClientRect();
      const GAP = 8;
      const EDGE_MARGIN = 16; // Minimum distance from viewport edge
      const centerX = r.left + r.width / 2;
      const hasSpaceAbove = r.top > 50;

      // Estimate bar width (approximate, can be adjusted based on actual measurements)
      const estimatedBarWidth = 300;
      const halfBarWidth = estimatedBarWidth / 2;

      // Determine horizontal position
      let leftPos = centerX;
      let horizontalTransform = "translateX(-50%)";

      // Check if centered position would overflow left edge
      if (centerX - halfBarWidth < EDGE_MARGIN) {
        leftPos = r.left;
        horizontalTransform = "translateX(0)";
      }
      // Check if centered position would overflow right edge
      else if (centerX + halfBarWidth > window.innerWidth - EDGE_MARGIN) {
        leftPos = r.right;
        horizontalTransform = "translateX(-100%)";
      }

      const style: React.CSSProperties = {
        position: "fixed",
        left: `${leftPos}px`,
        transform: horizontalTransform,
      };
      if (hasSpaceAbove) {
        style.top = `${r.top - GAP}px`;
        style.transform = horizontalTransform === "translateX(-50%)"
          ? "translate(-50%, -100%)"
          : horizontalTransform === "translateX(0)"
          ? "translate(0, -100%)"
          : "translate(-100%, -100%)";
      } else {
        style.top = `${r.bottom + GAP}px`;
      }
      return style;
    };
    setBarStyle(computeBarStyle());
    const update = () => setBarStyle(computeBarStyle());
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [element]);

  const handleReplace = useCallback(() => {
    const el = toolbarElementRef.current;
    const hovered = toolbarHoveredElementRef.current;
    if (!el || !hovered || hovered.type !== "image") return;
    const { imageUrl, isMediaSlot, slotPath } = hovered;
    if (isMediaSlot && slotPath) {
      safePostMessage(window.parent, { type: "OPEN_MEDIA_SLOT_DIALOG", slotName: slotPath });
    } else {
      const devContext = extractDevContext(el);
      const imgEl = el.tagName.toLowerCase() === "img" ? (el as HTMLImageElement) : null;
      safePostMessage(window.parent, {
        type: "AUTO_IMPORT_MEDIA_SLOT",
        imageUrl,
        devContext,
        imageType: imgEl ? "img" : "background",
        imageAlt: imgEl?.alt || "",
      });
    }
    setToolbarMode(false);
  }, []);

  const handleModify = useCallback(() => {
    const el = toolbarElementRef.current;
    const hovered = toolbarHoveredElementRef.current;
    if (!el || !hovered || hovered.type !== "image") return;
    const { imageUrl, isMediaSlot, slotPath } = hovered;
    if (isMediaSlot && slotPath) {
      safePostMessage(window.parent, { type: "OPEN_IMAGE_EDITOR", slotName: slotPath });
    } else {
      const devContext = extractDevContext(el);
      const imgEl = el.tagName.toLowerCase() === "img" ? (el as HTMLImageElement) : null;
      safePostMessage(window.parent, {
        type: "AUTO_IMPORT_MEDIA_SLOT",
        imageUrl,
        devContext,
        imageType: imgEl ? "img" : "background",
        imageAlt: imgEl?.alt || "",
        openEditor: true,
      });
    }
    setToolbarMode(false);
  }, []);

  // Build the EDIT_WITH_AI payload for the toolbar's captured element
  const buildContextData = useCallback((selectionNumber?: number): Record<string, unknown> => {
    const el = toolbarElementRef.current;
    const hovered = toolbarHoveredElementRef.current;
    if (!el || !hovered) {
      console.error("[ElementHoverBar] buildContextData called but no element captured");
      return {};
    }

    const elRect = el.getBoundingClientRect();
    const devContext = extractDevContext(el);
    const preciseSelector = generatePreciseSelector(el);
    const isImg = hovered.type === "image";

    const data: Record<string, unknown> = {
      elementInfo: {
        tagName: el.tagName.toLowerCase(),
        className: getElementClassName(el),
        id: el.id,
        dataId: devContext?.devId || '', // Maps to DOM data-dev-id; named dataId for ElementInfo API compat
        textContent: isImg ? "" : (el.textContent || "").substring(0, 500),
        computedStyles: {},
        rect: { top: elRect.top, left: elRect.left, width: elRect.width, height: elRect.height },
        selector: preciseSelector,
        preciseSelector,
        devContext,
      },
      selector: preciseSelector,
      devContext,
      selectionNumber,
    };

    if (hovered.type === "image") {
      data.imageInfo = {
        type: el.tagName.toLowerCase() === "img" ? "img" : "background",
        currentUrl: hovered.imageUrl,
      };
    }

    return data;
  }, []);

  // Reference: immediately show selection overlay and send context to chat
  const handleReference = useCallback(() => {
    const el = toolbarElementRef.current;
    if (!el) return;

    let selectionNumber: number | undefined;
    if (isMultiSelectActive) {
      if (el.hasAttribute("data-ai-selected-num")) return;
      selectionNumber = getNextSelectionNumber();
      const num = selectionNumber;
      addNumberedOverlay(el, num, () => {
        removeNumberedOverlay(num);
        safePostMessage(window.parent, { type: "REMOVE_SELECTION_FROM_PREVIEW", data: { number: num } });
      });
    } else {
      showSelectionOverlay(el);
    }
    const contextData = buildContextData(selectionNumber);
    safePostMessage(window.parent, { type: "EDIT_WITH_AI", data: contextData });
    setToolbarMode(false);
  }, [isMultiSelectActive, buildContextData]);

  // Sparkles: build context locally and open Quick Edit — no selection overlay,
  // no postMessage until the user submits the prompt
  const handleEditWithAI = useCallback(() => {
    pendingContextRef.current = buildContextData();
    setToolbarMode(false);
    setQuickEditMode(true);
  }, [buildContextData]);

  // On submit: send context first so the store is set before QUICK_EDIT_SEND reads it
  const handleQuickEditSubmit = useCallback((prompt: string) => {
    if (pendingContextRef.current) {
      safePostMessage(window.parent, { type: "EDIT_WITH_AI", data: pendingContextRef.current });
      pendingContextRef.current = null;
    }
    safePostMessage(window.parent, { type: "QUICK_EDIT_SEND", data: { prompt } });
    setQuickEditMode(false);
  }, []);

  const handleQuickEditDismiss = useCallback(() => {
    setQuickEditMode(false);
  }, []);

  // Follow: trigger the element's native click/navigation (for links and buttons)
  const elementIsClickable = isClickable(element);
  const handleFollow = useCallback(() => {
    const el = toolbarElementRef.current;
    if (!el) return;

    const anchor = el.closest("a") as HTMLAnchorElement | null;
    if (anchor?.href) {
      window.location.href = anchor.href;
    } else {
      // For buttons/role="button" — dispatch a click bypassing edit mode
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  }, []);

  // Bold/Italic: show for any text-bearing element (less strict than isTextEditable
  // which also rejects data-dev-dynamic — we only need class toggle, not text editing).
  // Suppress for loop-rendered elements (multiple DOM nodes from one source element).
  const devId = element.getAttribute("data-dev-id");
  const devLine = element.getAttribute("data-dev-line");
  const isLoopRendered = !!devId && !!devLine &&
    document.querySelectorAll(`[data-dev-id="${devId}"][data-dev-line="${devLine}"]`).length > 1;
  const elementIsText = !isImage && !isLoopRendered && TEXT_TAGS.has(element.tagName.toLowerCase()) && !!element.textContent?.trim();
  const targetEl = toolbarElementRef.current || element;
  const isBold = elementIsText && targetEl.classList.contains("font-bold");
  const isItalic = elementIsText && targetEl.classList.contains("italic");

  const handleToggleFormat = useCallback((property: "fontWeight" | "fontStyle") => {
    const el = toolbarElementRef.current;
    const hovered = toolbarHoveredElementRef.current;
    if (!el || !hovered) return;
    const isAdding = property === "fontWeight"
      ? !el.classList.contains("font-bold")
      : !el.classList.contains("italic");

    const value = property === "fontWeight"
      ? (isAdding ? "bold" : "normal")
      : (isAdding ? "italic" : "normal");

    const toggleClass = property === "fontWeight" ? "font-bold" : "italic";
    const originalClassName = el.className;

    // Optimistic DOM update for instant visual feedback
    if (isAdding) {
      el.classList.add(toggleClass);
    } else {
      el.classList.remove(toggleClass);
    }
    forceRender(n => n + 1);

    // Rollback on backend failure, clean up on success
    const handleResult = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if (e.data?.type === "STYLE_EDIT_FAILED") {
        el.className = originalClassName;
        forceRender(n => n + 1);
      }
      if (e.data?.type === "STYLE_EDIT_FAILED" || e.data?.type === "STYLE_EDIT_SUCCEEDED") {
        window.removeEventListener("message", handleResult);
      }
    };
    window.addEventListener("message", handleResult);

    const devContext = extractDevContext(el);
    const preciseSelector = generatePreciseSelector(el);
    const elRect = el.getBoundingClientRect();

    safePostMessage(window.parent, {
      type: "STYLE_UPDATED",
      data: {
        selector: preciseSelector,
        property,
        value,
        newClassName: el.className,
        elementInfo: {
          tagName: el.tagName.toLowerCase(),
          className: getElementClassName(el),
          id: el.id,
          dataId: devContext?.devId || "",
          textContent: (el.textContent || "").substring(0, 500),
          selector: preciseSelector,
          devContext,
          rect: { top: elRect.top, left: elRect.left, width: elRect.width, height: elRect.height },
          computedStyles: {},
        },
      },
    });
  }, []);

  if (quickEditMode) {
    return (
      <QuickEditBar
        style={barStyle}
        onSubmit={handleQuickEditSubmit}
        onDismiss={handleQuickEditDismiss}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    );
  }

  if (!toolbarMode) return null;

  return (
    <HoverBar style={barStyle} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {isImage && (
        <>
          <HoverBarButton
            onClick={handleReplace}
            title={t("devtools_image_replace_title", "Replace image")}
            icon={<Image width={15} height={15} />}
            label={t("devtools_image_replace", "Replace")}
          />
          <HoverBarButton
            onClick={handleModify}
            title={t("devtools_image_modify_title", "Modify image")}
            icon={<Pencil width={15} height={15} />}
            label={t("devtools_image_modify", "Modify")}
          />
        </>
      )}
      {elementIsText && (
        <>
          <HoverBarButton
            onClick={() => handleToggleFormat("fontWeight")}
            title={t("devtools_toggle_bold_title", "Toggle bold")}
            icon={<Bold width={15} height={15} />}
            active={isBold}
          />
          <HoverBarButton
            onClick={() => handleToggleFormat("fontStyle")}
            title={t("devtools_toggle_italic_title", "Toggle italic")}
            icon={<Italic width={15} height={15} />}
            active={isItalic}
          />
        </>
      )}
      <HoverBarButton
        onClick={handleReference}
        title={t("devtools_reference_title", "Add as reference")}
        icon={<Bookmark width={15} height={15} />}
        label={t("devtools_reference", "Reference")}
      />
      {elementIsClickable && (
        <HoverBarButton
          onClick={handleFollow}
          title={t("devtools_follow_link_title", "Follow link")}
          icon={<Pointer width={15} height={15} />}
        />
      )}
      <HoverBarButton
        onClick={handleEditWithAI}
        title={t("devtools_edit_with_ai", "Edit with AI")}
        icon={<Sparkles width={15} height={15} style={{ color: "var(--color-accent-purple)" }} />}
      />
    </HoverBar>
  );
}
