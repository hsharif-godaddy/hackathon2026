import { useCallback, useEffect, useState } from "react";
import { Bold } from "lucide-react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import { addStyleEditListener, StyleMessageEventType } from "../utils/elementStyleListeners";
import { extractDevContext, generatePreciseSelector, getElementClassName } from "../utils/element-helpers";
import { ensureBoldFontLoaded } from "../utils/text-editing-helpers";
import { send, trackEventBus } from "../utils/eventBus";

interface BoldButtonProps {
  selectedElement: HTMLElement | null;
}

export default function BoldButton({ selectedElement }: BoldButtonProps) {
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (selectedElement) ensureBoldFontLoaded(selectedElement);
  }, [selectedElement]);

  const isBold = selectedElement?.classList.contains("font-bold") ?? false;

  const handleToggleBold = useCallback(() => {
    if (!selectedElement) return;
    trackEventBus.click("devtools.toolbar.bold");

    const isAdding = !selectedElement.classList.contains("font-bold");
    const originalClassName = selectedElement.className;

    if (isAdding) {
      selectedElement.classList.add("font-bold");
    } else {
      selectedElement.classList.remove("font-bold");
    }
    forceRender((n: number) => n + 1);

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
        property: "fontWeight",
        value: isAdding ? "bold" : "normal",
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
    <HoverBarButton
      onClick={handleToggleBold}
      title={t("devtools_toggle_bold_title", "Toggle bold")}
      icon={<Bold width={15} height={15} />}
      active={isBold}
    />
  );
}
