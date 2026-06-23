import React, { useCallback, useEffect, useRef, useState } from "react";
import { type BusAiEditContextPayload, type BusElementInfo, send } from "../utils/eventBus";
import { generatePreciseSelector, extractDevContext, getElementClassName, parseCollectionOccurrenceIndex } from "../utils/element-helpers";
import { findMediaSlotDomIndex } from "../utils/media-slot-dom";
import {
  showSelectionOverlay,
  clearSelectionOverlay,
  addNumberedOverlay,
  removeNumberedOverlay,
  getNextSelectionNumber,
} from "../utils/selection-overlay";
import type { HoveredElement } from "../hooks/useImageHoverDetection";
import { Bookmark, Image, MousePointerClick, Pencil, Sparkles, Trash2 } from "lucide-react";
import { isClickable, isTextElement, isTextBlockElement, isListElement } from "../utils/element-detection";
import { followClickableElement, resolveFollowTarget } from "../utils/link-follow";
import {
  computeHoverBarStyle,
  computeLinkFollowBarStyle,
  OUTLINE_PAD,
  type VerticalPlacement,
} from "../utils/hover-bar-placement";
import { trackEventBus } from "../utils/eventBus";
import { t } from "../utils/translations";
import { HoverBar, HoverBarButton } from "./HoverBar";
import { LinkFollowBar } from "./LinkFollowBar";
import { QuickEditBar } from "./QuickEditBar";
import { TextFixPopover } from "./TextFixPopover";
import { ImageActionPopover } from "./ImageActionPopover";
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
import FontFamilyButton from "./FontFamilyButton";
import { nextOpenMenu, type HoverBarMenuId } from "../utils/popover-coordinator";
import FormatOverrideControls from "./FormatOverrideControls";
import { findFormatOverrideElement, isLoopRenderedElement } from "../utils/formatOverrideMessages";
import { isCommerceManagedContent } from "../utils/commerce-managed-content";

/**
 * Determine popover placement given available space.
 * Prefer below; flip above only if below doesn't fit but above does.
 */
export function computePopoverPlacement(
  spaceBelow: number,
  spaceAbove: number,
  pickerHeight: number,
): VerticalPlacement {
  if (spaceBelow >= pickerHeight) return "below";
  if (spaceAbove >= pickerHeight) return "above";
  return "below";
}

const DIRECT_FOREGROUND_IMAGE_TAGS = new Set(["img", "picture", "svg"]);

// AIROBUILD-1556: object-cover <img> with overlaid siblings = hero backdrop.
function isBackdropImage(el: HTMLElement): boolean {
  if (el.tagName.toLowerCase() !== "img") return false;
  const cs = getComputedStyle(el);
  if (cs.objectFit !== "cover") return false;
  const parent = el.parentElement;
  if (!parent) return false;
  return Array.from(parent.children).some((c) => c !== el && (c as HTMLElement).offsetWidth > 0);
}

function findEnclosingLink(el: HTMLElement): { href: string; isInternal: boolean } | null {
  const a = el.closest("a") as HTMLAnchorElement | null;
  if (!a) return null;
  const href = a.getAttribute("href") || "";
  if (!href) return null;
  const isInternal = href.startsWith("/") && !href.startsWith("//");
  return { href, isInternal };
}

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
  toolbarMode: boolean;
  setToolbarMode: (open: boolean) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onQuickEditModeChange?: (active: boolean) => void;
}

export default function ElementHoverBar({
  hoveredElement,
  isMultiSelectActive,
  toolbarMode,
  setToolbarMode,
  onMouseEnter,
  onMouseLeave,
  onQuickEditModeChange,
}: ElementHoverBarProps) {
  const { element } = hoveredElement;
  const isImage = hoveredElement.type === "image";
  const isVideo = hoveredElement.type === "image" && hoveredElement.isVideo;

  // Commerce UI (VITE_GODADDY_STORE_ID): product images come from the
  // Commerce API — hide Replace/Modify for images without data-dev-id or media slot.
  const isCommerceIntegrated = !!import.meta.env.VITE_GODADDY_STORE_ID;
  const isUneditableImage = isImage && !element.getAttribute("data-dev-id") && !hoveredElement.isMediaSlot;
  const isCommerceMutationBlocked = isCommerceManagedContent(element) || (isCommerceIntegrated && isUneditableImage);
  const showImageActions = isImage && !isCommerceMutationBlocked;
  // AIROBUILD-1556: foreground <img>/<picture>/<svg> only; backdrops excluded.
  const isForegroundImage = isImage && DIRECT_FOREGROUND_IMAGE_TAGS.has(element.tagName.toLowerCase());
  const isBackdrop = isForegroundImage && isBackdropImage(element);
  const showClickActionAction = showImageActions && isForegroundImage && !isBackdrop && !isVideo;
  const isImageLoopRendered = isForegroundImage && isLoopRenderedElement(element);
  const existingLink = isForegroundImage && !isBackdrop ? findEnclosingLink(element) : null;

  const [quickEditMode, setQuickEditMode] = useState(false);
  const [clickActionMode, setClickActionMode] = useState(false);
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
  const pendingContextRef = useRef<BusAiEditContextPayload | null>(null);
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

  // Reset auxiliary modes when the hovered element changes. toolbarMode is
  // owned by useImageHoverDetection so resetting it here would race click
  // commits and close the bar on first click.
  useEffect(() => {
    setQuickEditMode(false);
    setClickActionMode(false);
    setOpenMenu(null);
    pendingContextRef.current = null;
    // Cancel any in-flight fix request — the captured toolbarElementRef is
    // about to point at a different element, so a pending result would be stale.
    fix.reset();
    // Dep on `fix.reset` (a stable useCallback), NOT `fix` — the hook returns
    // a fresh object every render, so depending on `fix` would re-run this
    // effect every render and close the toolbar before it's visible.
  }, [element, fix.reset]);

  // Notify parent when toolbar or quick edit is active so it can freeze the element
  useEffect(() => {
    onQuickEditModeChange?.(toolbarMode || quickEditMode || clickActionMode);
  }, [toolbarMode, quickEditMode, clickActionMode, onQuickEditModeChange]);

  // Toolbar-view impression: fires once per appearance. Deps are [toolbarMode]
  // so this fires on open, not on element retarget within an open toolbar.
  useEffect(() => {
    if (!toolbarMode) return;
    trackEventBus.impression("devtools.toolbar.view", { surface: isImage ? "image" : "text" });
  }, [toolbarMode]);

  // Release the freeze when this component unmounts
  useEffect(() => {
    return () => onQuickEditModeChange?.(false);
  }, [onQuickEditModeChange]);

  // Capture the element/hoveredElement when toolbar opens so action handlers
  // (Replace, Modify, Reference, etc.) target the element the user clicked,
  // even if the cursor has since moved away. The click handler that flips
  // toolbarMode lives in useImageHoverDetection.
  useEffect(() => {
    if (toolbarMode) {
      toolbarElementRef.current = element;
      toolbarHoveredElementRef.current = hoveredElement;
    }
  }, [toolbarMode, element, hoveredElement]);

  // Dismiss toolbar/quick edit when clicking outside the bar, the element, or editor overlays
  useEffect(() => {
    if (!toolbarMode && !quickEditMode && !clickActionMode) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".edit-mode-hover-bar")) return;
      if (target.closest(".edit-mode-link-follow-bar")) return;
      if (element.contains(target)) return;
      if (target.closest("[data-dev-tools]") || target.closest("[data-airo-dev-tools]")) return;
      // Clear scroll-to-media selection overlay on click outside
      clearSelectionOverlay();
      setToolbarMode(false);
      setQuickEditMode(false);
      setClickActionMode(false);
      fix.reset();
      pendingContextRef.current = null;
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    // Dep on `fix.reset` (stable useCallback), not `fix` — see the
    // element-change effect above for the explanation.
  }, [toolbarMode, quickEditMode, clickActionMode, element, fix.reset]);

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
  const [linkBarStyle, setLinkBarStyle] = useState<React.CSSProperties>({});
  const [linkBarPlacement, setLinkBarPlacement] = useState<VerticalPlacement>("below");
  // Direction child popovers should open — separate for color (shorter) and font (taller).
  const [colorPickerPlacement, setColorPickerPlacement] = useState<VerticalPlacement>("below");
  const [fontPickerPlacement, setFontPickerPlacement] = useState<VerticalPlacement>("below");
  useEffect(() => {
    const GAP = 8;
    // Derived from ColorPicker's maxHeight.
    const COLOR_PICKER_HEIGHT = 280;
    // Derived from FontPicker's maxHeight style (360px)
    const FONT_PICKER_HEIGHT = 360;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const bounds = {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
      };
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const toolbar = computeHoverBarStyle(bounds, viewport);
      const linkBar = computeLinkFollowBarStyle(bounds, toolbar.placement, viewport);
      setBarStyle(toolbar.style);
      setLinkBarStyle(linkBar.style);
      setLinkBarPlacement(linkBar.placement);

      // Determine popover direction for tall pickers (color/font):
      // 1. If enough space below → show below
      // 2. Else if enough space above → show above
      // 3. Else (neither fits) → show below (better to clip at bottom than top)
      const placedAbove = toolbar.placement === "above";
      const barHeight = document.querySelector('.edit-mode-hover-bar')?.getBoundingClientRect().height ?? 44;
      const barBottomY = placedAbove
        ? (rect.top - GAP - OUTLINE_PAD) // bar translateY(-100%) makes this its bottom edge
        : (rect.bottom + GAP + OUTLINE_PAD + barHeight);
      const spaceBelow = viewport.height - barBottomY;
      const barTopY = placedAbove
        ? (rect.top - GAP - OUTLINE_PAD - barHeight)
        : (rect.bottom + GAP + OUTLINE_PAD);
      const spaceAbove = barTopY;
      setColorPickerPlacement(computePopoverPlacement(spaceBelow, spaceAbove, COLOR_PICKER_HEIGHT));
      setFontPickerPlacement(computePopoverPlacement(spaceBelow, spaceAbove, FONT_PICKER_HEIGHT));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
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
    trackEventBus.click("devtools.toolbar.replace_image");
    const { imageUrl, isMediaSlot, slotPath } = hovered;
    if (isMediaSlot && slotPath) {
      const targetEl = hovered.element;
      const devContext = extractDevContext(targetEl);
      const preciseSelector = generatePreciseSelector(targetEl);
      const imgEl = targetEl.tagName.toLowerCase() === "img" ? (targetEl as HTMLImageElement) : null;
      const occurrenceIndex = findMediaSlotDomIndex(targetEl, slotPath)
        ?? parseCollectionOccurrenceIndex(preciseSelector);
      send({
        type: "OPEN_MEDIA_SLOT_DIALOG",
        slotName: slotPath,
        occurrenceIndex,
        forkContext: {
          selector: preciseSelector,
          devContext: devContext ?? {
            fileName: "unknown",
            componentName: "unknown",
            lineNumber: 0,
          },
          elementInfo: {
            tagName: targetEl.tagName.toLowerCase(),
            className: getElementClassName(targetEl),
            id: targetEl.id,
            selector: preciseSelector,
            devContext: devContext ?? {
              fileName: "unknown",
              componentName: "unknown",
              lineNumber: 0,
            },
          },
          imageInfo: {
            type: imgEl ? "img" : "background",
            currentUrl: imageUrl,
            alt: imgEl?.alt || undefined,
          },
        },
      });
    } else {
      const devContext = extractDevContext(el);
      const imgEl = el.tagName.toLowerCase() === "img" ? (el as HTMLImageElement) : null;
      send({
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
    trackEventBus.click("devtools.toolbar.modify_image");
    const { imageUrl, isMediaSlot, slotPath } = hovered;
    if (isMediaSlot && slotPath) {
      send({ type: "OPEN_IMAGE_EDITOR", slotName: slotPath });
    } else {
      const devContext = extractDevContext(el);
      const imgEl = el.tagName.toLowerCase() === "img" ? (el as HTMLImageElement) : null;
      send({
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

  // Delete media: mirror handleReplace's capture pattern, then post
  // DELETE_MEDIA_ELEMENT. The builder opens a confirmation modal; the actual
  // AST removal happens there.
  const handleDelete = useCallback(() => {
    const el = toolbarElementRef.current;
    const hovered = toolbarHoveredElementRef.current;
    if (!el || !hovered || hovered.type !== "image") return;
    trackEventBus.click("devtools.toolbar.delete_media");
    // Read isVideo off the captured element, not the live `isVideo` closure —
    // hover may have moved since the toolbar opened (same discipline as handleReplace).
    const capturedIsVideo = !!hovered.isVideo;
    const elRect = el.getBoundingClientRect();
    const devContext = extractDevContext(el);
    const preciseSelector = generatePreciseSelector(el);
    const imgEl = el.tagName.toLowerCase() === "img" ? (el as HTMLImageElement) : null;
    const elementInfo: BusElementInfo = {
      tagName: el.tagName.toLowerCase(),
      className: getElementClassName(el),
      id: el.id,
      dataId: devContext?.devId || "",
      textContent: "",
      computedStyles: {},
      rect: { top: elRect.top, left: elRect.left, width: elRect.width, height: elRect.height },
      selector: preciseSelector,
      preciseSelector,
      devContext,
    };
    send({
      type: "DELETE_MEDIA_ELEMENT",
      data: {
        selector: preciseSelector,
        preciseSelector,
        devContext,
        elementInfo,
        isVideo: capturedIsVideo,
        imageUrl: hovered.imageUrl ?? null,
        alt: imgEl?.alt || undefined,
      },
    });
    setToolbarMode(false);
  }, []);

  // Build the EDIT_WITH_AI payload for the toolbar's captured element
  const buildContextData = useCallback((selectionNumber?: number): BusAiEditContextPayload | null => {
    const el = toolbarElementRef.current;
    const hovered = toolbarHoveredElementRef.current;
    if (!el || !hovered) {
      console.error("[ElementHoverBar] buildContextData called but no element captured");
      return null;
    }

    const elRect = el.getBoundingClientRect();
    const devContext = extractDevContext(el);
    const preciseSelector = generatePreciseSelector(el);
    const isImg = hovered.type === "image";

    const data: BusAiEditContextPayload = {
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
      const imgEl = el.tagName.toLowerCase() === "img" ? (el as HTMLImageElement) : null;
      data.imageInfo = {
        type: imgEl ? "img" : "background",
        currentUrl: hovered.imageUrl,
        alt: imgEl?.alt || "",
      };
    }

    return data;
  }, []);

  // Reference: immediately show selection overlay and send context to chat
  const handleReference = useCallback(() => {
    const el = toolbarElementRef.current;
    if (!el) return;
    trackEventBus.click("devtools.toolbar.multi_select_add");

    let selectionNumber: number | undefined;
    if (isMultiSelectActive) {
      if (el.hasAttribute("data-ai-selected-num")) return;
      selectionNumber = getNextSelectionNumber();
      const num = selectionNumber;
      addNumberedOverlay(el, num, () => {
        trackEventBus.click("devtools.toolbar.multi_select_remove");
        removeNumberedOverlay(num);
        send({ type: "REMOVE_SELECTION_FROM_PREVIEW", data: { number: num } });
      });
    } else {
      showSelectionOverlay(el);
    }
    const contextData = buildContextData(selectionNumber);
    if (contextData) send({ type: "EDIT_WITH_AI", data: contextData });
    setToolbarMode(false);
  }, [isMultiSelectActive, buildContextData]);

  // Sparkles: build context locally and open Quick Edit — no selection overlay,
  // no postMessage until the user submits the prompt
  const handleEditWithAI = useCallback(() => {
    if (isCommerceMutationBlocked) return;

    trackEventBus.click("devtools.toolbar.sparkles");
    pendingContextRef.current = buildContextData();
    setToolbarMode(false);
    setQuickEditMode(true);
  }, [buildContextData, isCommerceMutationBlocked]);

  // AIROBUILD-1556: same context-capture pattern as Sparkles, opens popover.
  const handleEditClickAction = useCallback(() => {
    trackEventBus.click("devtools.toolbar.image_click_action");
    pendingContextRef.current = buildContextData();
    setToolbarMode(false);
    setClickActionMode(true);
  }, [buildContextData]);

  // On submit: send context first so the store is set before QUICK_EDIT_SEND reads it
  const handleQuickEditSubmit = useCallback((prompt: string) => {
    trackEventBus.click("devtools.toolbar.quick_edit_submit");
    if (pendingContextRef.current) {
      send({ type: "EDIT_WITH_AI", data: pendingContextRef.current });
      pendingContextRef.current = null;
    }
    send({ type: "QUICK_EDIT_SEND", data: { prompt } });
    setQuickEditMode(false);
  }, []);

  const handleQuickEditDismiss = useCallback(() => {
    trackEventBus.click("devtools.toolbar.quick_edit_dismiss");
    setQuickEditMode(false);
  }, []);

  const handleClickActionSubmit = useCallback((prompt: string) => {
    trackEventBus.click("devtools.toolbar.image_click_action_submit");
    if (pendingContextRef.current) {
      send({ type: "EDIT_WITH_AI", data: pendingContextRef.current });
      pendingContextRef.current = null;
    }
    send({ type: "QUICK_EDIT_SEND", data: { prompt } });
    setClickActionMode(false);
  }, []);

  const handleClickActionDismiss = useCallback(() => {
    trackEventBus.click("devtools.toolbar.image_click_action_dismiss");
    setClickActionMode(false);
    pendingContextRef.current = null;
  }, []);

  const elementIsClickable = isClickable(element);
  const followTarget = elementIsClickable
    ? resolveFollowTarget(toolbarElementRef.current || element)
    : null;
  const handleFollow = useCallback(() => {
    const el = toolbarElementRef.current;
    if (!el) return;
    trackEventBus.click("devtools.link_follow.open");
    followClickableElement(el);
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
    trackEventBus.click("devtools.toolbar.text_fix_accept");
    fix.accept(el);
    setToolbarMode(false);
  }, [fix.accept]);

  const handleFixReject = useCallback(() => {
    trackEventBus.click("devtools.toolbar.text_fix_reject");
    fix.reject();
  }, [fix.reject]);

  // Bold/Italic: show for any text-bearing element (less strict than isTextEditable
  // which also rejects data-dev-dynamic — we only need class toggle, not text editing).
  // Suppress for loop-rendered elements (multiple DOM nodes from one source element).
  const isLoopRendered = isLoopRenderedElement(element);
  const boundFormatElement = !isImage ? findFormatOverrideElement(element) : null;
  const isBoundTextFormatEligible = !isCommerceMutationBlocked && !!boundFormatElement && !!boundFormatElement.textContent?.trim();
  const elementIsText = !isCommerceMutationBlocked && !isImage && !isLoopRendered && !isBoundTextFormatEligible && isTextElement(element) && !!element.textContent?.trim();
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

  if (clickActionMode) {
    const imgEl = element.tagName.toLowerCase() === "img" ? (element as HTMLImageElement) : null;
    return (
      <ImageActionPopover
        style={barStyle}
        onSubmit={handleClickActionSubmit}
        onDismiss={handleClickActionDismiss}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        existingLink={existingLink}
        isLoopRendered={isImageLoopRendered}
        targetAlt={imgEl?.alt || ""}
        targetSrc={imgEl?.getAttribute("src") || ""}
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
        onReject={handleFixReject}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    );
  }

  if (!toolbarMode) return null;

  return (
    <>
      <HoverBar style={barStyle} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {showImageActions && (
          <>
            <HoverBarButton
              onClick={handleReplace}
              title={t("devtools_image_replace_title", "Replace image")}
              icon={<Image width={15} height={15} />}
              label={t("devtools_image_replace", "Replace")}
            />
            {!isVideo && (
              <HoverBarButton
                onClick={handleModify}
                title={t("devtools_image_modify_title", "Modify image")}
                icon={<Pencil width={15} height={15} />}
                label={t("devtools_image_modify", "Modify")}
              />
            )}
            {showClickActionAction && (
              <HoverBarButton
                onClick={handleEditClickAction}
                title={t("devtools_image_click_action_title", "Set click action")}
                icon={<MousePointerClick width={15} height={15} />}
                label={t("devtools_image_click_action", "On click")}
              />
            )}
            <HoverBarButton
              onClick={handleDelete}
              title={t("devtools_delete_media_title", "Delete")}
              icon={<Trash2 width={15} height={15} />}
            />
          </>
        )}
        {isBoundTextFormatEligible && (
          <FormatOverrideControls selectedElement={boundFormatElement} colorMenu={menuController("color")} popoverPlacement={colorPickerPlacement} />
        )}
        {elementIsText && (
          <>
            <BoldButton selectedElement={targetEl} />
            <ItalicButton selectedElement={targetEl} />
            <TextColorButton selectedElement={targetEl} {...menuController("color")} popoverPlacement={colorPickerPlacement} />
            <TextSizeStepperButton selectedElement={targetEl} {...menuController("size")} />
            <FontFamilyButton selectedElement={targetEl} {...menuController("font")} popoverPlacement={fontPickerPlacement} />
            {isTextBlockElement(element) && (
              <TextAlignButton selectedElement={targetEl} {...menuController("align")} />
            )}
            {fixEligible && <TextFixButton state={fix.state} onFix={handleFix} />}
          </>
        )}
        {!isCommerceMutationBlocked && !isLoopRendered && isListElement(element) && <ListTypeButton selectedElement={targetEl} {...menuController("list")} />}
        <HoverBarButton
          onClick={handleReference}
          title={t("devtools_reference_title", "Add as reference")}
          icon={<Bookmark width={15} height={15} />}
        />
        {!isCommerceMutationBlocked && (
          <HoverBarButton
            onClick={handleEditWithAI}
            title={t("devtools_edit_with_ai", "Edit with AI")}
            icon={<Sparkles width={15} height={15} style={{ color: "var(--color-accent-purple)" }} />}
          />
        )}
      </HoverBar>
      {followTarget && (
        <LinkFollowBar
          style={linkBarStyle}
          placement={linkBarPlacement}
          target={followTarget}
          onFollow={handleFollow}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        />
      )}
    </>
  );
}
