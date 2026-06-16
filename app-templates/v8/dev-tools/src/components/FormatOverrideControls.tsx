import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Italic, X } from "lucide-react";

import ColorPicker from "./ColorPicker";
import { HoverBarButton } from "./HoverBar";
import { applyOptimisticFormatPreview } from "../utils/formatOverridePreview";
import { t } from "../utils/translations";
import { send } from "../utils/eventBus";
import { extractThemeColors } from "../utils/text-editing-helpers";
import {
  FormatOverrideMessageEventType,
  addFormatOverrideEditListener,
  readCurrentFormatOverrideMarks,
  readFormatOverrideTarget,
  type FormatOverrideMarks,
} from "../utils/formatOverrideMessages";
import type { PopoverController } from "../utils/popover-coordinator";
import type { VerticalPlacement } from "../utils/hover-bar-placement";

interface FormatOverrideControlsProps {
  selectedElement: HTMLElement | null;
  colorMenu: PopoverController;
  /** Direction the popover should open relative to the button. Defaults to "below". */
  popoverPlacement?: VerticalPlacement;
}

const DEFAULT_COLOR = "#000000";

function normalizeMarks(marks: FormatOverrideMarks): Required<FormatOverrideMarks> {
  return {
    bold: !!marks.bold,
    italic: !!marks.italic,
    color: marks.color || null,
  };
}

function readInitialMarks(selectedElement: HTMLElement | null): Required<FormatOverrideMarks> {
  return normalizeMarks(selectedElement ? readCurrentFormatOverrideMarks(selectedElement) : {});
}

export default function FormatOverrideControls({ selectedElement, colorMenu, popoverPlacement = "below" }: FormatOverrideControlsProps) {
  const [marks, setMarks] = useState<Required<FormatOverrideMarks>>(() => readInitialMarks(selectedElement));
  const marksRef = useRef(marks);
  const latestEditRef = useRef(0);
  const [themeColors, setThemeColors] = useState<string[]>([]);

  useEffect(() => {
    const initialMarks = readInitialMarks(selectedElement);
    marksRef.current = initialMarks;
    setMarks(initialMarks);
  }, [selectedElement]);

  const postMarks = useCallback((nextMarks: Required<FormatOverrideMarks>) => {
    if (!selectedElement) return;

    const formatTarget = readFormatOverrideTarget(selectedElement);
    if (!formatTarget) return;

    const previousMarks = marksRef.current;
    const editId = latestEditRef.current + 1;
    latestEditRef.current = editId;
    marksRef.current = nextMarks;
    setMarks(nextMarks);
    const optimisticPreview = applyOptimisticFormatPreview(selectedElement, nextMarks);

    const rollbackOptimisticEdit = () => {
      optimisticPreview.rollback();
      if (latestEditRef.current !== editId) return;
      marksRef.current = previousMarks;
      setMarks(previousMarks);
    };

    const commitId = addFormatOverrideEditListener((event) => {
      if (event.data.type === FormatOverrideMessageEventType.EDIT_FAILED) {
        rollbackOptimisticEdit();
      }
      // EDIT_SUCCEEDED is intentionally a no-op: the runtime sidecar bundle
      // update owns clearing the optimistic preview and rendering persisted marks.
    }, rollbackOptimisticEdit);

    send({
      type: FormatOverrideMessageEventType.UPDATED,
      data: {
        commitId,
        devId: formatTarget.devId,
        target: formatTarget.target,
        marks: nextMarks,
      },
    });
  }, [selectedElement]);

  const toggleBold = useCallback(() => {
    postMarks({ ...marks, bold: !marks.bold });
  }, [marks, postMarks]);

  const toggleItalic = useCallback(() => {
    postMarks({ ...marks, italic: !marks.italic });
  }, [marks, postMarks]);

  const changeColor = useCallback((color: string) => {
    postMarks({ ...marks, color });
  }, [marks, postMarks]);

  const clearColor = useCallback(() => {
    postMarks({ ...marks, color: null });
  }, [marks, postMarks]);

  const toggleColorMenu = useCallback(() => {
    if (colorMenu.isOpen) {
      setThemeColors([]);
      colorMenu.onOpenChange(false);
      return;
    }

    setThemeColors(extractThemeColors());
    colorMenu.onOpenChange(true);
  }, [colorMenu]);

  const clearColorTitle = t("devtools_clear_text_color_title", "Clear text color");

  return (
    <>
      <HoverBarButton
        onClick={toggleBold}
        title={t("devtools_toggle_bold_title", "Toggle bold")}
        icon={<Bold width={15} height={15} />}
        active={marks.bold}
      />
      <HoverBarButton
        onClick={toggleItalic}
        title={t("devtools_toggle_italic_title", "Toggle italic")}
        icon={<Italic width={15} height={15} />}
        active={marks.italic}
      />
      <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
        <HoverBarButton
          onClick={toggleColorMenu}
          title={t("devtools_text_color_title", "Text color")}
          icon={
            <span style={{
              display: "block",
              width: "17px",
              height: "17px",
              borderRadius: "50%",
              background: marks.color || DEFAULT_COLOR,
              border: "1px solid rgba(0,0,0,0.15)",
              boxSizing: "border-box",
            }} />
          }
          active={colorMenu.isOpen}
        />
        {colorMenu.isOpen && (
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
              value={marks.color || DEFAULT_COLOR}
              onChange={() => undefined}
              onChangeEnd={changeColor}
              themeColors={themeColors}
            >
              {marks.color && (
                <button
                  type="button"
                  aria-label={clearColorTitle}
                  title={clearColorTitle}
                  onClick={clearColor}
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "4px",
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    color: "#374151",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <X width={14} height={14} />
                </button>
              )}
            </ColorPicker>
          </div>
        )}
      </div>
    </>
  );
}
