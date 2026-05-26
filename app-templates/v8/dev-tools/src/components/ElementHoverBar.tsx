import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { Bookmark, Image, Pencil, Pointer, Sparkles } from "lucide-react";
import { isClickable, isTextElement, isTextBlockElement, isListElement } from "../utils/element-detection";
import { t } from "../utils/translations";
import { HoverBar, HoverBarButton } from "./HoverBar";
import { QuickEditBar } from "./QuickEditBar";
import { TextFixPopover } from "./TextFixPopover";
import TextFixButton from "./TextFixButton";
import { useTextFix } from "../hooks/useTextFix";
import { useSpeechBridge } from "../hooks/useSpeechBridge";
import { htmlStringToDisplayText } from "../utils/text-fix-helpers";
import TextAlignButton from "./TextAlignButton";
import ListTypeButton from "./ListTypeButton";
import BoldButton from "./BoldButton";
import ItalicButton from "./ItalicButton";
import TextColorButton from "./TextColorButton";
import TextSizeStepperButton from "./TextSizeStepperButton";
import { nextOpenMenu, type HoverBarMenuId } from "../utils/popover-coordinator";


const OUTLINE_PAD = 8;

const HOVER_PULSE_STYLE_ID = "airo-hover-pulse-keyframes";

function ensureHoverPulseKeyframes(): void {
  if (document.getElementById(HOVER_PULSE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HOVER_PULSE_STYLE_ID;
  style.textContent = `
    @keyframes airoHoverPulse {
      0%, 100% {
        box-shadow:
          0 0 4px 0 rgba(255,255,255,0.11),
          0 0 2px rgba(255,255,255,0.18);
      }
      50% {
        box-shadow:
          0 0 10px 2px rgba(255,255,255,0.25),
          0 0 5px rgba(255,255,255,0.33);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-airo-hover-overlay] { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

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

  // Commerce Storefront (VITE_GODADDY_STORE_ID): product images come from the
  // Commerce API — hide Replace/Modify for images without data-dev-id or media slot.
  const isCommerceIntegrated = !!import.meta.env.VITE_GODADDY_STORE_ID;
  const isUneditableImage = isImage && !element.getAttribute("data-dev-id") && !hoveredElement.isMediaSlot;
  const showImageActions = isImage && !(isCommerceIntegrated && isUneditableImage);

  const [toolbarMode, setToolbarMode] = useState(false);
  const [quickEditMode, setQuickEditMode] = useState(false);
  // Single source of truth for which Hover Bar popover is open (Color Picker /
  // Size Stepper / Text Align). Children are controlled — opening one
  // implicitly closes any other so they never stack on screen.
  const [openMenu, setOpenMenu] = useState<HoverBarMenuId | null>(null);
  const menuController = useCallback(
    (id: HoverBarMenuId) => ({
      isOpen: openMenu === id,
      onOpenChange: (open: boolean) => setOpenMenu((curr) => nextOpenMenu(curr, id, open)),
    }),
    [openMenu],
  );
  // Context built when Sparkles is clicked — sent only when Quick Edit is submitted
  const pendingContextRef = useRef<Record<string, unknown> | null>(null);
  // Capture the element reference when toolbar opens so actions use the correct element
  // even if hover moves away (e.g., mouse enters toolbar, causing parent to track a new hover)
  const toolbarElementRef = useRef<HTMLElement | null>(null);
  const toolbarHoveredElementRef = useRef<HoveredElement | null>(null);

  // ── Text-fix (proofread) lifecycle ──
  // The button posts TEXT_FIX_REQUESTED to the parent, which calls a small
  // LLM and replies with TEXT_FIX_RESULT. We render a diff popover for review;
  // on Accept the hook emits the standard TEXT_UPDATED payload through the
  // existing AST text-edit pipeline. State + request lifecycle live in the
  // hook; the button render lives in TextFixButton.
  const fix = useTextFix();
  const speech = useSpeechBridge();

  // Outline overlay + pointer cursor on the hovered element.
  // Uses a fixed-position div so the outline stays visible even when
  // useTextEditing hides the element (visibility:hidden) for Lexical editing.
  const outlineRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ensureHoverPulseKeyframes();
    element.style.cursor = "pointer";
    const overlay = document.createElement("div");
    overlay.setAttribute("data-airo-dev-tools", "");
    overlay.setAttribute("data-airo-hover-overlay", "");
    overlay.style.position = "fixed";
    overlay.style.border = "1px solid #8b5cf6";
    overlay.style.background = "rgba(139,92,246,0.1)";
    // Static fallback for prefers-reduced-motion (animation is suppressed).
    overlay.style.boxShadow = "0 0 4px 0 rgba(255,255,255,0.11), 0 0 2px rgba(255,255,255,0.18)";
    overlay.style.animation = "airoHoverPulse 3.2s ease-in-out infinite";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "9999";
    const updatePos = () => {
      const r = element.getBoundingClientRect();
      overlay.style.top = `${r.top - OUTLINE_PAD}px`;
      overlay.style.left = `${r.left - OUTLINE_PAD}px`;
      overlay.style.width = `${r.width + OUTLINE_PAD * 2}px`;
      overlay.style.height = `${r.height + OUTLINE_PAD * 2}px`;
    };
    updatePos();
    document.body.appendChild(overlay);
    outlineRef.current = overlay;
    // Update on viewport scroll/resize AND when the element itself changes
    // size — the stepper, color picker, and other class-toggle controls can
    // mutate the element's bounding box without firing a window resize, and
    // the outline used to stay anchored to the pre-mutation rect.
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    const elementResizeObserver = new ResizeObserver(updatePos);
    elementResizeObserver.observe(element);
    return () => {
      overlay.remove();
      outlineRef.current = null;
      element.style.cursor = "";
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
      elementResizeObserver.disconnect();
    };
  }, [element]);

  // Reset all modes when the hovered element changes
  useEffect(() => {
    setToolbarMode(false);
    setQuickEditMode(false);
    setOpenMenu(null);
    pendingContextRef.current = null;
    // Cancel any in-flight fix request — the captured toolbarElementRef is
    // about to point at a different element, so a pending result would be stale.
    fix.reset();
    // Dep on `fix.reset` (a stable useCallback), NOT `fix` — the hook returns
    // a fresh object every render, so depending on `fix` would re-run this
    // effect every render and close the toolbar before it's visible.
  }, [element, fix.reset]);

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
  //
  // useLayoutEffect (not useEffect) so closure re-registration happens
  // synchronously during commit. Pairs with the mousedown→flushSync handler
  // in useImageHoverDetection: when the user clicks within the hover-detect
  // showBarTimer window, that handler flushes the pending `hoveredElement`
  // state, React commits + runs this layout effect, the new closure (with the
  // fresh `element` prop) is attached — all before the click event fires.
  // With plain useEffect, the cleanup/reattach would be deferred past the
  // click and the stale closure would still bail on the target check.
  useLayoutEffect(() => {
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
      fix.reset();
      pendingContextRef.current = null;
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    // Dep on `fix.reset` (stable useCallback), not `fix` — see the
    // element-change effect above for the explanation.
  }, [toolbarMode, quickEditMode, element, fix.reset]);

  // Track toolbar/popover position, updating on scroll/resize so it follows
  // the element. Both surfaces share the same computed style so the popover
  // replaces the toolbar at the exact same anchor — clicking Fix and seeing
  // the diff appear in a different part of the page breaks the action↔result
  // visual link.
  //
  // The clearance threshold is 200px (the popover's worst-case height) —
  // larger than the toolbar strictly needs, but using a single threshold
  // keeps both surfaces consistent. Trade-off: for an element 80px from the
  // viewport top, the toolbar will render below it instead of squeezing
  // above. That's acceptable; the alternative (toolbar above, popover below)
  // is the bug we're fixing here.
  const [barStyle, setBarStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    const MIN_CLEARANCE_ABOVE = 200;
    const computeBarStyle = (): React.CSSProperties => {
      const r = element.getBoundingClientRect();
      const GAP = 8;
      const EDGE_MARGIN = 16; // Minimum distance from viewport edge
      const centerX = r.left + r.width / 2;
      const hasSpaceAbove = r.top > MIN_CLEARANCE_ABOVE;

      // Estimate bar width (approximate, can be adjusted based on actual measurements)
      const estimatedBarWidth = 350;
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
        style.top = `${r.top - GAP - OUTLINE_PAD}px`;
        style.transform = horizontalTransform === "translateX(-50%)"
          ? "translate(-50%, -100%)"
          : horizontalTransform === "translateX(0)"
          ? "translate(0, -100%)"
          : "translate(-100%, -100%)";
      } else {
        style.top = `${r.bottom + GAP + OUTLINE_PAD}px`;
      }
      return style;
    };
    setBarStyle(computeBarStyle());
    const update = () => setBarStyle(computeBarStyle());
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // Track element size changes (stepper / class toggles can grow or shrink
    // the bounding box without firing a window resize) so the bar stays
    // pinned above/below the element instead of drifting.
    const elementResizeObserver = new ResizeObserver(update);
    elementResizeObserver.observe(element);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      elementResizeObserver.disconnect();
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

  // Fix (proofread): see useTextFix for the request lifecycle. We capture the
  // toolbar's element ref at click time so the action targets the element the
  // user clicked, not whatever the cursor has since hovered onto.
  const handleFix = useCallback(() => {
    const el = toolbarElementRef.current;
    if (!el) return;
    fix.request(el);
  }, [fix.request]);

  const handleFixAccept = useCallback(() => {
    const el = toolbarElementRef.current;
    if (!el) return;
    fix.accept(el);
    setToolbarMode(false);
  }, [fix.accept]);

  // Bold/Italic: show for any text-bearing element (less strict than isTextEditable
  // which also rejects data-dev-dynamic — we only need class toggle, not text editing).
  // Suppress for loop-rendered elements (multiple DOM nodes from one source element).
  const devId = element.getAttribute("data-dev-id");
  const devLine = element.getAttribute("data-dev-line");
  const isLoopRendered = !!devId && !!devLine &&
    document.querySelectorAll(`[data-dev-id="${devId}"][data-dev-line="${devLine}"]`).length > 1;
  const elementIsText = !isImage && !isLoopRendered && isTextElement(element) && !!element.textContent?.trim();
  const targetEl = toolbarElementRef.current || element;
  // Fix is available on any text element with non-trivial text content. The
  // agent prompt handles HTML preservation, and the commit always goes
  // through the `newHtml` path, so nested inline elements (`<br>`, `<span>`,
  // `<strong>`, `<a>`, etc.) round-trip without a special-case gate here.
  const fixEligible = elementIsText && (targetEl.textContent || "").trim().length > 2;


  if (quickEditMode) {
    return (
      <QuickEditBar
        style={barStyle}
        onSubmit={handleQuickEditSubmit}
        onDismiss={handleQuickEditDismiss}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        speech={speech}
      />
    );
  }

  // The Fix-flow diff popover replaces the toolbar at the same anchor point —
  // same pattern as QuickEditBar — so the user's eye doesn't have to track to
  // a different spot to choose Accept/Reject. Both share `barStyle`, which
  // uses the popover's clearance threshold so they always agree on placement.
  if (fix.state.status === "preview") {
    // The popover diffs the human-readable text view of each HTML string —
    // tags would be noise in the diff. `htmlStringToDisplayText` parses the
    // HTML and recursively flattens, treating `<br>` as `\n`.
    const oldDisplay = htmlStringToDisplayText(fix.state.oldHtml);
    const newDisplay = htmlStringToDisplayText(fix.state.newHtml);
    return (
      <TextFixPopover
        style={barStyle}
        oldText={oldDisplay}
        newText={newDisplay}
        onAccept={handleFixAccept}
        onReject={fix.reject}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    );
  }

  if (!toolbarMode) return null;

  return (
    <HoverBar style={barStyle} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {showImageActions && (
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
          <BoldButton selectedElement={targetEl} />
          <ItalicButton selectedElement={targetEl} />
          <TextColorButton selectedElement={targetEl} {...menuController("color")} />
          <TextSizeStepperButton selectedElement={targetEl} {...menuController("size")} />
          {isTextBlockElement(element) && (
            <TextAlignButton selectedElement={targetEl} {...menuController("align")} />
          )}
          {fixEligible && <TextFixButton state={fix.state} onFix={handleFix} />}
        </>
      )}
      {!isLoopRendered && isListElement(element) && <ListTypeButton selectedElement={targetEl} {...menuController("list")} />}
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
