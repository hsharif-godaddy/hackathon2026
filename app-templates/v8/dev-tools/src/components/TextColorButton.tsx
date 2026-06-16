import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import { addStyleEditListener, StyleMessageEventType } from "../utils/elementStyleListeners";
import { extractDevContext, generatePreciseSelector, getElementClassName } from "../utils/element-helpers";
import { extractThemeColors } from "../utils/text-editing-helpers";
import { rgbToHex, normalizeHex } from "../utils/color";
import { send, trackEventBus } from "../utils/eventBus";
import type { VerticalPlacement } from "../utils/hover-bar-placement";
import ColorPicker from "./ColorPicker";

const DEFAULT_COLOR = "#000000";

interface TextColorButtonProps {
  selectedElement: HTMLElement | null;
  /** Controlled popover state — parent (`ElementHoverBar`) coordinates so
   *  Color Picker / Size Stepper / Text Align never stack on top of each other. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Direction the popover should open relative to the button. Defaults to "below". */
  popoverPlacement?: VerticalPlacement;
}

/**
 * Converts a CSS color string from `getComputedStyle` into a normalized hex value.
 *
 * Most browsers serialize computed `color` as `rgb(r, g, b)` or `rgba(r, g, b, a)`,
 * but unusual values — `currentcolor`, `color-mix()`, system color keywords — can
 * fall through the regex and produce `null`. The caller logs a warning and falls back
 * to `DEFAULT_COLOR` in that case.
 *
 * The alpha channel is intentionally ignored: the color picker only works with
 * opaque colors and the `color` CSS property does not carry opacity on its own.
 *
 * @param computed - The raw string from `getComputedStyle(el).color`,
 *                   e.g. `"rgb(255, 0, 0)"` or `"rgba(0, 128, 0, 0.5)"`.
 * @returns A normalized 6-digit hex string (e.g. `"#ff0000"`),
 *          or `null` if the input could not be parsed.
 */
function parseComputedColor(computed: string): string | null {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(computed);
  if (!match) {
    return null;
  }

  return normalizeHex(rgbToHex(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10))) || null;
}

/**
 * Hover-bar button for setting `color` (text color) on a text element.
 * Displays a live color-swatch button that opens a ColorPicker popover.
 * Applies the picked color as an inline style, persists via STYLE_UPDATED
 * postMessage, and rolls back on STYLE_EDIT_FAILED.
 *
 * Parent (`ElementHoverBar`) is responsible for gating to text elements.
 */
export default function TextColorButton({ selectedElement, isOpen, onOpenChange, popoverPlacement = "below" }: TextColorButtonProps) {
  const [themeColors, setThemeColors] = useState<string[]>([]);
  const [, forceRender] = useState(0);

  // Snapshot of the element's inline color when the picker opens.
  // Used by handleColorChange's listener to roll back on agent failure.
  // Capturing once on open (not per-commit) prevents rollback from landing
  // on a prior drag pixel instead of the true original color.
  const originalColorRef = useRef<string>("");

  // Last color the user actually committed (drag-end / hex / swatch) during
  // the current picker session. On close we revert el.style.color to this so
  // a mid-drag close doesn't leave an uncommitted preview stuck on the element.
  // `null` means "no active picker session" — revert paths gate on this to
  // avoid wiping a customer-set inline color when the toolbar closes without
  // ever opening the picker.
  const lastCommittedColorRef = useRef<string | null>(null);

  // Saved value of `el.style.transition` from before the picker opened so we
  // can restore it on close. While the picker is open we inject a `color 200ms`
  // transition so drag updates and discrete commits glide instead of snapping.
  const prevTransitionRef = useRef<string | null>(null);

  // Tracks computed-color values we've already warned about (one log per
  // distinct unparseable value) to avoid console spam across many elements.
  const warnedColorsRef = useRef<Set<string>>(new Set());

  // Shared revert helper used by both the toggleMenu close path and the
  // useEffect cleanup. Reverts any uncommitted mid-drag preview color and
  // restores the element's injected transition. Ref resets always run even
  // when element is null so the "no active session" sentinel stays clean
  // across element swaps. Only closes over stable refs — no deps needed.
  const revertPickerState = useCallback((element: HTMLElement | null) => {
    if (element) {
      const lastCommitted = lastCommittedColorRef.current;
      if (lastCommitted !== null && element.style.color !== lastCommitted) {
        element.style.color = lastCommitted;
      }
      if (prevTransitionRef.current !== null) {
        element.style.transition = prevTransitionRef.current;
      }
    }
    prevTransitionRef.current = null;
    lastCommittedColorRef.current = null;
  }, []);

  // Covers the "click outside toolbar" and "hover away" dismiss paths —
  // runs whenever selectedElement changes or the component unmounts.
  useEffect(() => {
    if (!selectedElement) return;
    return () => revertPickerState(selectedElement)
  }, [selectedElement, revertPickerState]);

  // Memoized: during a drag, handleColorPreview calls forceRender on every
  // pixel — the memo stays cached so we skip getComputedStyle per frame.
  // The swatch button color stays stale while the picker is open (fine, the
  // user is looking at the picker) and resyncs when isOpen flips to false.
  const currentColor = useMemo((): string => {
    if (!selectedElement) {
      return DEFAULT_COLOR;
    }

    const computed = getComputedStyle(selectedElement).color;
    const hex = parseComputedColor(computed);

    if (hex) {
      return hex
    }

    if (!warnedColorsRef.current.has(computed)) {
      warnedColorsRef.current.add(computed);
      console.warn(
        "[dev-tools] Could not parse current text color; picker falling back to #000000.",
        { computed, tag: selectedElement.tagName.toLowerCase() },
      );
    }

    return DEFAULT_COLOR;
  }, [selectedElement, isOpen]);

  const toggleMenu = useCallback(() => {
    if (isOpen) {
      revertPickerState(selectedElement);
      setThemeColors([]);
      onOpenChange(false);
      return;
    }

    // Opening — extract theme swatches, snapshot the current color, and
    // inject a smooth transition so drag previews and commits animate.
    setThemeColors(extractThemeColors());
    if (selectedElement) {
      originalColorRef.current = selectedElement.style.color;
      lastCommittedColorRef.current = originalColorRef.current;
      prevTransitionRef.current = selectedElement.style.transition;
      selectedElement.style.transition = "color 200ms ease";
    }
    onOpenChange(true);
  }, [isOpen, selectedElement, revertPickerState, onOpenChange]);

  // Optimistic visual update only — fires on every drag pixel from ColorPicker.
  // Does NOT send STYLE_UPDATED so we don't produce a git commit per pixel.
  const handleColorPreview = useCallback((hex: string) => {
    if (selectedElement) {
      selectedElement.style.color = hex;
      forceRender((count: number) => count + 1);
    }
  }, [selectedElement]);

  // Persist + optimistic update — fires on drag-end, hex commit, or swatch click.
  // This is the only path that talks to the agent.
  const handleColorChange = useCallback((hex: string) => {
    if (!selectedElement) return;
    trackEventBus.click("devtools.toolbar.text_color");

    selectedElement.style.color = hex;
    // Advance the "last committed" baseline so a close after this commit
    // reverts to this color, not back to the pre-picker original.
    lastCommittedColorRef.current = hex;
    forceRender((count: number) => count + 1);

    const commitId = addStyleEditListener((event: MessageEvent) => {
      if (event.data.type === StyleMessageEventType.EDIT_FAILED) {
        // Roll back to the color the element had when the picker first opened,
        // not whatever a later commit may have painted on top.
        selectedElement.style.color = originalColorRef.current;
        lastCommittedColorRef.current = originalColorRef.current;
        forceRender((count: number) => count + 1);
      }
    });

    const devContext = extractDevContext(selectedElement);
    const preciseSelector = generatePreciseSelector(selectedElement);

    send({
      type: StyleMessageEventType.UPDATED,
      data: {
        commitId,
        selector: preciseSelector,
        property: "color",
        value: hex,
        newClassName: selectedElement.className,
        elementInfo: {
          tagName: selectedElement.tagName.toLowerCase(),
          className: getElementClassName(selectedElement),
          id: selectedElement.id,
          dataId: devContext?.devId || "",
          textContent: (selectedElement.textContent || "").substring(0, 500),
          selector: preciseSelector,
          devContext,
          rect: selectedElement.getBoundingClientRect(),
          computedStyles: {},
        },
      },
    });
  }, [selectedElement]);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
      <HoverBarButton
        onClick={toggleMenu}
        title={t("devtools_text_color_title", "Text color")}
        suppressTooltip={isOpen}
        icon={
          <span style={{
            display: "block",
            width: "17px",
            height: "17px",
            borderRadius: "50%",
            background: currentColor,
            border: "1px solid rgba(0,0,0,0.15)",
            boxSizing: "border-box",
          }} />
        }
        active={isOpen}
      />
      {isOpen && (
        <div
          data-airo-dev-tools=""
          style={{
            position: "absolute",
            ...(popoverPlacement === "above"
              ? { bottom: "calc(100% + 4px)" }
              : { top: "calc(100% + 4px)" }),
            left: 0,
            zIndex: 100002,
          }}
        >
          <ColorPicker
            value={currentColor}
            onChange={handleColorPreview}
            onChangeEnd={handleColorChange}
            themeColors={themeColors}
          />
        </div>
      )}
    </div>
  );
}
