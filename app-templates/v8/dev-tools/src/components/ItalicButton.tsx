import { useCallback, useState } from "react";
import { Italic } from "lucide-react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import { addStyleEditListener, StyleMessageEventType } from "../utils/elementStyleListeners";
import { extractDevContext, generatePreciseSelector, getElementClassName } from "../utils/element-helpers";
import { send, trackEventBus } from "../utils/eventBus";

interface ItalicButtonProps {
  selectedElement: HTMLElement | null;
}

export default function ItalicButton({ selectedElement }: ItalicButtonProps) {
  const [, forceRender] = useState(0);

  const isItalic = selectedElement?.classList.contains("italic") ?? false;

  const handleToggleItalic = useCallback(() => {
    if (!selectedElement) return;
    trackEventBus.click("devtools.toolbar.italic");

    const isAdding = !selectedElement.classList.contains("italic");
    const originalClassName = selectedElement.className;

    if (isAdding) {
      selectedElement.classList.add("italic");
    } else {
      selectedElement.classList.remove("italic");
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
        property: "fontStyle",
        value: isAdding ? "italic" : "normal",
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
      onClick={handleToggleItalic}
      title={t("devtools_toggle_italic_title", "Toggle italic")}
      icon={<Italic width={15} height={15} />}
      active={isItalic}
    />
  );
}
