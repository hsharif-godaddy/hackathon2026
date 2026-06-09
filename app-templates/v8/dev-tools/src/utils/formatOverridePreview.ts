import type { FormatOverrideMarks } from "./formatOverrideMessages";

const FORMAT_OVERRIDES_WILL_UPDATE_EVENT = "airo-format-overrides:will-update";
const FORMATTED_BOUND_TEXT_SELECTOR = "[data-airo-formatted-bound-text]";

interface StyleSnapshot {
  element: HTMLElement;
  fontWeight: string;
  fontStyle: string;
  color: string;
}

interface OptimisticFormatPreview {
  rollback: () => void;
}

let activeSnapshot: StyleSnapshot | null = null;

function readSnapshot(element: HTMLElement): StyleSnapshot {
  return {
    element,
    fontWeight: element.style.fontWeight,
    fontStyle: element.style.fontStyle,
    color: element.style.color,
  };
}

function restoreSnapshot(snapshot: StyleSnapshot): void {
  snapshot.element.style.fontWeight = snapshot.fontWeight;
  snapshot.element.style.fontStyle = snapshot.fontStyle;
  snapshot.element.style.color = snapshot.color;
}

function resolvePreviewElement(selectedElement: HTMLElement): { element: HTMLElement; isFormattedWrapper: boolean } {
  const formatted = selectedElement.querySelector(FORMATTED_BOUND_TEXT_SELECTOR) as HTMLElement | null;
  return formatted
    ? { element: formatted, isFormattedWrapper: true }
    : { element: selectedElement, isFormattedWrapper: false };
}

function applyMarks(element: HTMLElement, marks: Required<FormatOverrideMarks>, isFormattedWrapper: boolean): void {
  // Only formatted wrappers receive false/null clears; unformatted elements may
  // carry author styles that a transient preview should not erase.
  if (marks.bold || isFormattedWrapper) {
    element.style.fontWeight = marks.bold ? "700" : "";
  }
  if (marks.italic || isFormattedWrapper) {
    element.style.fontStyle = marks.italic ? "italic" : "";
  }
  if (marks.color || isFormattedWrapper) {
    element.style.color = marks.color || "";
  }
}

export function applyOptimisticFormatPreview(
  selectedElement: HTMLElement,
  marks: Required<FormatOverrideMarks>,
): OptimisticFormatPreview {
  if (activeSnapshot) {
    restoreSnapshot(activeSnapshot);
    activeSnapshot = null;
  }

  const { element, isFormattedWrapper } = resolvePreviewElement(selectedElement);
  const snapshot = readSnapshot(element);
  activeSnapshot = snapshot;
  applyMarks(element, marks, isFormattedWrapper);

  const cleanup = () => {
    window.removeEventListener(FORMAT_OVERRIDES_WILL_UPDATE_EVENT, cleanup);
    if (activeSnapshot === snapshot) {
      restoreSnapshot(snapshot);
      activeSnapshot = null;
    }
  };

  window.addEventListener(FORMAT_OVERRIDES_WILL_UPDATE_EVENT, cleanup, { once: true });
  return { rollback: cleanup };
}
