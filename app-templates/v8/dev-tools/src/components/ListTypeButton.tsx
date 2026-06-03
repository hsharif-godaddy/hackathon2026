import { useCallback, useState } from "react";
import { List, ListOrdered } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import { addStyleEditListener, StyleMessageEventType } from "../utils/elementStyleListeners";
import { extractDevContext, generatePreciseSelector, getElementClassName } from "../utils/element-helpers";
import { send, trackEventBus } from "../utils/eventBus";

enum ListType {
  DISC = "disc",
  DECIMAL = "decimal",
}

const LIST_TYPE_ICONS: Record<ListType, LucideIcon> = {
  [ListType.DISC]: List,
  [ListType.DECIMAL]: ListOrdered,
};

/** Returns the list type class currently on the element, or null if none is set. */
function getListType(selectedElement?: HTMLElement | null): ListType | null {
  if (selectedElement?.classList.contains("list-disc")) return ListType.DISC;
  if (selectedElement?.classList.contains("list-decimal")) return ListType.DECIMAL;
  return null;
}

interface ListTypeButtonProps {
  selectedElement: HTMLElement | null;
  /** Controlled popover state — parent (`ElementHoverBar`) coordinates so
   *  Color Picker / Size Stepper / Text Align / List Type never stack. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Hover-bar dropdown for setting `list-style-type` on a list element (ul/ol).
 * Class-toggle pattern (no inline style); applies the chosen `list-{value}`
 * Tailwind class, persists via STYLE_UPDATED postMessage, and rolls back on
 * STYLE_EDIT_FAILED.
 *
 * Parent (`ElementHoverBar`) is responsible for gating to list tags (ul/ol).
 */
export default function ListTypeButton({ selectedElement, isOpen, onOpenChange }: ListTypeButtonProps) {
  const [, forceRender] = useState(0);

  const currentListType: ListType | null = getListType(selectedElement);
  const CurrentIcon = currentListType ? LIST_TYPE_ICONS[currentListType] : List;

  const handleListTypeChange = useCallback(
    (newListType: ListType | null) => {
      if (!selectedElement) return;
      trackEventBus.click("devtools.toolbar.list_type");

      const originalClassName = selectedElement.className;
      Object.values(ListType).forEach((type) => selectedElement.classList.remove(`list-${type}`));
      selectedElement.classList.remove("[&>*]:list-item");

      if (newListType) {
        selectedElement.classList.add(`list-${newListType}`); // Add the list type
        selectedElement.classList.add("[&>*]:list-item"); // Make all children list items
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
          property: "listStyleType",
          value: newListType ?? "",
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
        title={t("devtools_list_type_title", "List type")}
        suppressTooltip={isOpen}
        icon={<CurrentIcon width={15} height={15} />}
        active={isOpen || !!currentListType}
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
          {Object.values(ListType).map((type) => {
            const Icon = LIST_TYPE_ICONS[type];
            return (
              <HoverBarButton
                key={type}
                onClick={() => handleListTypeChange(currentListType === type ? null : type)}
                title={t(`devtools_list_type_${type}_title`, `List ${type}`)}
                icon={<Icon width={15} height={15} />}
                active={currentListType === type}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
