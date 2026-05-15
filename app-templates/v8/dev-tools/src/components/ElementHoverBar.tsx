import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ensureBoldFontLoaded } from "../utils/text-editing-helpers";
import { t } from "../utils/translations";
import { HoverBar, HoverBarButton } from "./HoverBar";
import { QuickEditBar } from "./QuickEditBar";
import ColorPicker from "./ColorPicker";
import { extractThemeColors } from "../utils/text-editing-helpers";
import { rgbToHex, normalizeHex } from "../utils/color";

/** Tags eligible for bold/italic toggle (text-bearing inline/block elements). */
const TEXT_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "label", "li", "blockquote"]);

/** Generate a unique id per style commit so the iframe-side listener can
 *  correlate a STYLE_EDIT_SUCCEEDED / STYLE_EDIT_FAILED reply to the specific
 *  in-flight commit it's responding to (prevents cross-talk when multiple
 *  commits are in flight, e.g. drag-end immediately followed by a swatch click).
 *  Falls back to time+random if `crypto.randomUUID` is unavailable. */
function makeCommitId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Listener auto-cleanup window. If the parent never replies (timeout, iframe
 *  navigation, channel break), the listener detaches itself instead of
 *  leaking for the rest of the session. */
const STYLE_REPLY_TIMEOUT_MS = 30_000;

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
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [themeColors, setThemeColors] = useState<string[]>([]);
  const [, forceRender] = useState(0);
  // Context built when Sparkles is clicked — sent only when Quick Edit is submitted
  const pendingContextRef = useRef<Record<string, unknown> | null>(null);
  // Capture the element reference when toolbar opens so actions use the correct element
  // even if hover moves away (e.g., mouse enters toolbar, causing parent to track a new hover)
  const toolbarElementRef = useRef<HTMLElement | null>(null);
  const toolbarHoveredElementRef = useRef<HoveredElement | null>(null);
  // Snapshot of the element's pre-edit inline color, captured ONCE when the
  // picker opens. Used by handleColorCommit to roll back on agent failure.
  // Capturing per-call would snapshot the previous drag pixel's color and
  // make rollback land somewhere mid-drag instead of at the original.
  const originalColorRef = useRef<string>("");
  // Last color the user actually committed (drag-end / hex / swatch) during
  // the current picker session. On close we revert el.style.color to this so
  // a mid-drag close doesn't leave an uncommitted preview stuck on the
  // element. `null` means "no active picker session" — the revert paths must
  // gate on that to avoid wiping a customer-set inline color (e.g. v8's
  // `style={{ color: "hsl(var(--accent-foreground))" }}`) when the toolbar is
  // dismissed without ever opening the picker.
  const lastCommittedColorRef = useRef<string | null>(null);
  // Saved value of `el.style.transition` from before the picker opened, so we
  // can restore it on close. While the picker is open we set a `color 200ms`
  // transition so both drag updates and discrete swatch/hex commits glide
  // instead of snapping. `null` ⇒ no active picker session.
  const prevTransitionRef = useRef<string | null>(null);
  // Tracks computed-color values we've already warned about (one log per
  // distinct unparseable value). Without dedupe, hovering across many
  // elements with the same unparseable value (currentcolor, color-mix,
  // system colors, etc.) would spam the console.
  const warnedColorsRef = useRef<Set<string>>(new Set());

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
    // Revert any uncommitted color preview before tearing down picker state.
    // Gate on a non-null ref so we only touch elements that had an active
    // picker session — otherwise we'd wipe customer-authored inline colors.
    const el = toolbarElementRef.current;
    const lastCommitted = lastCommittedColorRef.current;
    if (el && lastCommitted !== null && el.style.color !== lastCommitted) {
      el.style.color = lastCommitted;
    }
    if (el && prevTransitionRef.current !== null) {
      el.style.transition = prevTransitionRef.current;
    }
    prevTransitionRef.current = null;
    lastCommittedColorRef.current = null;
    setShowColorPicker(false);
    setThemeColors([]);
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
      // Revert any uncommitted color preview before closing the picker so a
      // mid-drag dismiss doesn't leave an unsaved color stuck on the element.
      // Null ref ⇒ no picker session, so leave inline color alone.
      const el = toolbarElementRef.current;
      const lastCommitted = lastCommittedColorRef.current;
      if (el && lastCommitted !== null && el.style.color !== lastCommitted) {
        el.style.color = lastCommitted;
      }
      if (el && prevTransitionRef.current !== null) {
        el.style.transition = prevTransitionRef.current;
      }
      prevTransitionRef.current = null;
      lastCommittedColorRef.current = null;
      setShowColorPicker(false);
      setThemeColors([]);
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
  // Pages often ship only the weight they use; preload both 400 and 700 so the
  // bold toggle has a visible effect in either direction. Helper dedupes per font.
  useEffect(() => {
    if (elementIsText) ensureBoldFontLoaded(targetEl);
  }, [elementIsText, targetEl]);

  // Toggle the picker. When opening, extract theme colors and snapshot the
  // element's current inline color synchronously (before the next render) so
  // the first frame of the open popover has correct state — avoids the brief
  // flash where the Theme Color section appears empty then populates.
  const toggleColorPicker = useCallback(() => {
    setShowColorPicker((open: boolean) => {
      if (open) {
        // Closing via the toolbar button — same revert path as click-outside.
        const el = toolbarElementRef.current;
        const lastCommitted = lastCommittedColorRef.current;
        if (el && lastCommitted !== null && el.style.color !== lastCommitted) {
          el.style.color = lastCommitted;
          forceRender(n => n + 1);
        }
        if (el && prevTransitionRef.current !== null) {
          el.style.transition = prevTransitionRef.current;
        }
        prevTransitionRef.current = null;
        lastCommittedColorRef.current = null;
        setThemeColors([]);
        return false;
      }
      setThemeColors(extractThemeColors());
      if (toolbarElementRef.current) {
        originalColorRef.current = toolbarElementRef.current.style.color;
        lastCommittedColorRef.current = originalColorRef.current;
        prevTransitionRef.current = toolbarElementRef.current.style.transition;
        toolbarElementRef.current.style.transition = "color 200ms ease";
      }
      return true;
    });
  }, []);

  // Resolve the element's current text color as a hex string for the picker.
  // getComputedStyle().color is normalized to rgb()/rgba() on every modern
  // engine today, but unusual serializations (currentcolor, color-mix, system
  // colors, future formats) may not match. When that happens we fall back to
  // black and warn — once per unique unparseable value — so the picker
  // opening on the wrong baseline is at least debuggable.
  //
  // Memoized on [targetEl, elementIsText, showColorPicker]: during a drag,
  // handleColorPreview calls forceRender on every pixel; without memoization
  // we'd re-run getComputedStyle (and force a style flush) per frame. The
  // toolbar button's color indicator stays stale during the drag — fine,
  // since the user is looking at the picker swatch row — and resyncs when
  // showColorPicker flips back to false on close.
  const currentColorHex = useMemo(() => {
    if (!elementIsText) return "#000000";
    const computed = getComputedStyle(targetEl).color;
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(computed);
    if (!m) {
      if (!warnedColorsRef.current.has(computed)) {
        warnedColorsRef.current.add(computed);
        console.warn("[dev-tools] Could not parse current text color; picker falling back to #000000.", { computed, tag: targetEl.tagName.toLowerCase() });
      }
      return "#000000";
    }
    return normalizeHex(rgbToHex(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10))) || "#000000";
  }, [targetEl, elementIsText, showColorPicker]);

  // Optimistic visual update only — fires on every drag pixel from the picker.
  // Does NOT send STYLE_UPDATED so we don't spam the agent with one edit per
  // drag pixel (would result in dozens of git commits per drag).
  const handleColorPreview = useCallback((hex: string) => {
    const el = toolbarElementRef.current;
    if (!el) return;
    el.style.color = hex;
    forceRender(n => n + 1);
  }, []);

  // Persist + optimistic update — fires on drag end / hex commit / theme swatch
  // click. This is the only path that talks to the agent.
  const handleColorCommit = useCallback((hex: string) => {
    const el = toolbarElementRef.current;
    const hovered = toolbarHoveredElementRef.current;
    if (!el || !hovered) return;

    // Transition is set on the element when the picker opens and restored
    // on close (see toggleColorPicker), so all color assignments — drag
    // previews, swatch clicks, hex commits — interpolate uniformly.
    el.style.color = hex;
    // Optimistically advance the "last committed" baseline. If the agent
    // later replies FAILED, the listener below rolls all the way back to
    // originalColorRef (the pre-picker color), and we resync here too.
    lastCommittedColorRef.current = hex;
    forceRender(n => n + 1);

    // Per-commit id: lets the listener match its own reply when multiple
    // commits are in flight (drag-end + swatch click). Without correlation,
    // an earlier reply would prematurely fire/clean up unrelated listeners.
    const commitId = makeCommitId();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handleResult = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const type = e.data?.type;
      if (type !== "STYLE_EDIT_FAILED" && type !== "STYLE_EDIT_SUCCEEDED") return;
      // Only act on the reply tagged with our commit id.
      if (e.data?.commitId !== commitId) return;
      if (timeoutId !== null) clearTimeout(timeoutId);
      window.removeEventListener("message", handleResult);
      if (type === "STYLE_EDIT_FAILED") {
        // Roll back to the color the element had when the picker first opened,
        // not whatever a later commit may have just painted on top.
        el.style.color = originalColorRef.current;
        lastCommittedColorRef.current = originalColorRef.current;
        forceRender(n => n + 1);
      }
    };
    window.addEventListener("message", handleResult);
    timeoutId = setTimeout(() => {
      window.removeEventListener("message", handleResult);
      console.warn("[dev-tools] STYLE_UPDATED reply timed out; listener detached", { commitId, property: "color" });
    }, STYLE_REPLY_TIMEOUT_MS);

    const devContext = extractDevContext(el);
    const preciseSelector = generatePreciseSelector(el);
    const elRect = el.getBoundingClientRect();

    safePostMessage(window.parent, {
      type: "STYLE_UPDATED",
      data: {
        commitId,
        selector: preciseSelector,
        property: "color",
        value: hex,
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

    // Per-commit id: see handleColorCommit for rationale. With multiple style
    // edits possibly in flight (e.g. user toggles bold then immediately picks
    // a color), a reply must be matched to its commit before any DOM rollback.
    const commitId = makeCommitId();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handleResult = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const type = e.data?.type;
      if (type !== "STYLE_EDIT_FAILED" && type !== "STYLE_EDIT_SUCCEEDED") return;
      if (e.data?.commitId !== commitId) return;
      if (timeoutId !== null) clearTimeout(timeoutId);
      window.removeEventListener("message", handleResult);
      if (type === "STYLE_EDIT_FAILED") {
        el.className = originalClassName;
        forceRender(n => n + 1);
      }
    };
    window.addEventListener("message", handleResult);
    timeoutId = setTimeout(() => {
      window.removeEventListener("message", handleResult);
      console.warn("[dev-tools] STYLE_UPDATED reply timed out; listener detached", { commitId, property });
    }, STYLE_REPLY_TIMEOUT_MS);

    const devContext = extractDevContext(el);
    const preciseSelector = generatePreciseSelector(el);
    const elRect = el.getBoundingClientRect();

    safePostMessage(window.parent, {
      type: "STYLE_UPDATED",
      data: {
        commitId,
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
          <div style={{ position: "relative" }}>
            <HoverBarButton
              onClick={toggleColorPicker}
              title={t("devtools_text_color_title", "Text color")}
              icon={
                <span style={{
                  display: "block",
                  width: "17px",
                  height: "17px",
                  borderRadius: "50%",
                  background: currentColorHex,
                  border: "1px solid rgba(0,0,0,0.15)",
                  boxSizing: "border-box",
                }} />
              }
              active={showColorPicker}
            />
            {showColorPicker && (
              <div
                data-airo-dev-tools=""
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  zIndex: 100002,
                }}
              >
                <ColorPicker
                  value={currentColorHex}
                  onChange={handleColorPreview}
                  onChangeEnd={handleColorCommit}
                  themeColors={themeColors}
                />
              </div>
            )}
          </div>
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
