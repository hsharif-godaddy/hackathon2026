import { useCallback, useState } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import { addStyleEditListener, StyleMessageEventType } from "../utils/elementStyleListeners";
import { extractDevContext, generatePreciseSelector, getElementClassName } from "../utils/element-helpers";
import { send, trackEventBus } from "../utils/eventBus";

enum TextAlign {
  Left = "left",
  Center = "center",
  Right = "right",
  Justify = "justify",
}

const ALIGN_ICONS: Record<TextAlign, LucideIcon> = {
  [TextAlign.Left]: AlignLeft,
  [TextAlign.Center]: AlignCenter,
  [TextAlign.Right]: AlignRight,
  [TextAlign.Justify]: AlignJustify,
};

/** Returns the alignment class currently on the element, or null if none is set
 *  (the element is using its inherited / default alignment). Returning null on
 *  "no class" is intentional — defaulting to "left" would lie about state for
 *  RTL pages or for elements that inherit alignment from a parent. */
function getTextAlign(selectedElement?: HTMLElement | null): TextAlign | null {
  if (selectedElement?.classList.contains("text-center")) {
    return TextAlign.Center;
  }

  if (selectedElement?.classList.contains("text-right")) {
    return TextAlign.Right;
  }

  if (selectedElement?.classList.contains("text-justify")) {
    return TextAlign.Justify;
  }

  if (selectedElement?.classList.contains("text-left")) {
    return TextAlign.Left;
  }

  return null;
}

interface TextAlignButtonProps {
  selectedElement: HTMLElement | null;
  /** Controlled popover state — parent (`ElementHoverBar`) coordinates so
   *  Color Picker / Size Stepper / Text Align never stack on top of each other. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Hover-bar dropdown for setting `text-align` on a block-level text element.
 * Class-toggle pattern (no inline style); applies the chosen `text-{value}`
 * Tailwind class, persists via STYLE_UPDATED postMessage, and rolls back on
 * STYLE_EDIT_FAILED.
 *
 * Parent (`ElementHoverBar`) is responsible for gating to block-level tags —
 * `text-align` has no effect on inline elements like span/a/label.
 */
export default function TextAlignButton({ selectedElement, isOpen, onOpenChange }: TextAlignButtonProps) {
  // Used to re-render after we mutate classList directly so the icon and
  // active state reflect the new alignment without waiting on the parent.
  const [, forceRender] = useState(0);

  const currentTextAlign: TextAlign | null = getTextAlign(selectedElement);
  const CurrentIcon = currentTextAlign ? ALIGN_ICONS[currentTextAlign] : AlignLeft;

  const handleTextAlignChange = useCallback(
    (newTextAlign: TextAlign | null) => {
      if (!selectedElement) return;
      trackEventBus.click("devtools.toolbar.text_align");

      const originalClassName = selectedElement.className;
      // Optimistic DOM update: remove any existing alignment class, then add the new one.
      Object.values(TextAlign).forEach((align => selectedElement.classList.remove(`text-${align}`)))

      if (newTextAlign) {
        selectedElement.classList.add(`text-${newTextAlign}`);
      }

      forceRender((n: number) => n + 1);
      onOpenChange(false);

      const commitId = addStyleEditListener((event: MessageEvent) => {
        if (event.data.type === StyleMessageEventType.EDIT_FAILED) {
          selectedElement.className = originalClassName;
          forceRender((n: number) => n + 1);
        }
      });

      const devContext = extractDevContext(selectedElement);
      const preciseSelector = generatePreciseSelector(selectedElement);

      send({
        type: StyleMessageEventType.UPDATED,
        data: {
          commitId,
          selector: preciseSelector,
          property: "textAlign",
          value: newTextAlign ?? "",
          newClassName: selectedElement.className,
          elementInfo: {
            tagName: selectedElement.tagName.toLowerCase(),
            className: getElementClassName(selectedElement),
            id: selectedElement.id,
            dataId: devContext?.devId || "",
            textContent: selectedElement.textContent?.substring(0, 500) || "",
            selector: preciseSelector,
            devContext,
            rect: selectedElement.getBoundingClientRect(),
            computedStyles: {},
          },
        },
      });
    },
    [selectedElement],
  );

  return (
    <div className="relative flex items-stretch">
      <HoverBarButton
        onClick={() => onOpenChange(!isOpen)}
        title={t("devtools_text_align_title", "Text alignment")}
        suppressTooltip={isOpen}
        icon={<CurrentIcon width={15} height={15} />}
        active={isOpen || !!currentTextAlign}
      />
      {isOpen && (
        <div
          data-airo-dev-tools=""
          className="flex gap-1 p-1 rounded-xl absolute bg-white"
          style={{
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 100002,
            border: "1px solid rgba(0,0,0,0.1)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          {Object.values(TextAlign).map((align) => {
            const Icon = ALIGN_ICONS[align];
            return (
              <HoverBarButton
                key={align}
                onClick={() => handleTextAlignChange(currentTextAlign === align ? null : align)}
                title={t(`devtools_align_${align}_title`, `Align ${align}`)}
                icon={<Icon width={15} height={15} />}
                active={currentTextAlign === align}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
