import { useCallback, useEffect, useRef, useState } from "react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import { safePostMessage } from "../utils/postMessage";
import { addStyleEditListener, StyleMessageEventType } from "../utils/elementStyleListeners";
import { extractDevContext, generatePreciseSelector, getElementClassName } from "../utils/element-helpers";
import { getFontList, recordRecentFont, FontOption, FontList } from "../utils/getFontList";
import { trackEventBus } from "../utils/eventBus";
import type { VerticalPlacement } from "../utils/hover-bar-placement";
import FontPicker from "./FontPicker";
import { Type } from "lucide-react";

interface FontFamilyButtonProps {
  selectedElement: HTMLElement | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Direction the popover should open relative to the button. Defaults to "below". */
  popoverPlacement?: VerticalPlacement;
}

/**
 * Hover-bar button for setting `font-family` on a text element.
 * Opens a FontPicker popover listing theme fonts and custom web-safe fonts.
 * Applies the chosen font as an inline style, persists via
 * STYLE_UPDATED postMessage, and rolls back on STYLE_EDIT_FAILED.
 */
export default function FontFamilyButton({ selectedElement, isOpen, onOpenChange, popoverPlacement = "below" }: FontFamilyButtonProps) {
  const [fontList, setFontList] = useState<FontList>({ theme: [], recent: [], custom: [] });
  const [activeFont, setActiveFont] = useState<string>("");

  // Immutable snapshot of the font when the picker opened — used for rollback on failure.
  const originalFontRef = useRef<string>("");
  // Tracks the last successfully committed font during this picker session.
  // On close we revert to this so an uncommitted preview doesn't persist.
  const lastCommittedFontRef = useRef<string | null>(null);

  // Revert uncommitted preview on close or unmount.
  const revertPickerState = useCallback((element: HTMLElement | null) => {
    if (element) {
      const lastCommitted = lastCommittedFontRef.current;
      if (lastCommitted !== null && element.style.getPropertyValue("font-family") !== lastCommitted) {
        if (lastCommitted) {
          element.style.setProperty("font-family", lastCommitted, "important");
        } else {
          element.style.removeProperty("font-family");
        }
      }
    }
    lastCommittedFontRef.current = null;
  }, []);

  useEffect(() => {
    if (!selectedElement) return;
    return () => revertPickerState(selectedElement);
  }, [selectedElement, revertPickerState]);

  const closePicker = useCallback(() => {
    revertPickerState(selectedElement);
    setFontList({ theme: [], recent: [], custom: [] });
    onOpenChange(false);
  }, [selectedElement, revertPickerState, onOpenChange]);

  const toggleMenu = useCallback(() => {
    if (isOpen) {
      closePicker();
      return;
    }

    // Open: snapshot current inline font-family, detect active font, and load font list.
    if (selectedElement) {
      originalFontRef.current = selectedElement.style.getPropertyValue("font-family");
      lastCommittedFontRef.current = originalFontRef.current;
      const computed = getComputedStyle(selectedElement).fontFamily;
      setActiveFont(computed);
    }
    setFontList(getFontList());
    onOpenChange(true);
  }, [isOpen, selectedElement, closePicker, onOpenChange]);

  const handleFontSelect = useCallback((font: FontOption) => {
    if (!selectedElement) return;
    trackEventBus.click("devtools.toolbar.font_family");

    // Optimistic inline style update — use !important to override theme rules on headings.
    selectedElement.style.setProperty("font-family", font.value, "important");
    setActiveFont(font.value);

    // Register rollback listener before sending.
    const commitId = addStyleEditListener((event: MessageEvent) => {
      if (event.data.type === StyleMessageEventType.EDIT_FAILED) {
        // Roll back to the font the element had when the picker first opened.
        if (originalFontRef.current) {
          selectedElement.style.setProperty("font-family", originalFontRef.current, "important");
        } else {
          selectedElement.style.removeProperty("font-family");
        }
        lastCommittedFontRef.current = originalFontRef.current;
      } else if (event.data.type === StyleMessageEventType.EDIT_SUCCEEDED) {
        recordRecentFont(font);
      }
    });

    const devContext = extractDevContext(selectedElement);
    const preciseSelector = generatePreciseSelector(selectedElement);

    safePostMessage(window.parent, {
      type: StyleMessageEventType.UPDATED,
      data: {
        commitId,
        selector: preciseSelector,
        property: "fontFamily",
        value: font.value,
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

    // Advance the "last committed" baseline so a close after this commit
    // reverts to this font, not back to the pre-picker original.
    lastCommittedFontRef.current = font.value;
    onOpenChange(false);
  }, [selectedElement, onOpenChange]);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
      <HoverBarButton
        onClick={toggleMenu}
        title={t("devtools_font_family_title", "Font family")}
        icon={<Type width={15} height={15} />}
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
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100002,
          }}
        >
          <FontPicker
            fontList={fontList}
            activeFont={activeFont}
            onSelect={handleFontSelect}
            onClickOutside={closePicker}
          />
        </div>
      )}
    </div>
  );
}
