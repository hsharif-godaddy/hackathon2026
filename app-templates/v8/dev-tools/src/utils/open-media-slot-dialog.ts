import { detectImage, getMediaSlotPath } from "./element-detection";
import {
  extractDevContext,
  generatePreciseSelector,
  getElementClassName,
  parseCollectionOccurrenceIndex,
} from "./element-helpers";
import { send } from "./eventBus";
import { findMediaSlotDomIndex } from "./media-slot-dom";

export function openMediaSlotDialogForElement(
  targetEl: HTMLElement,
  options?: { skipPreviewScroll?: boolean; carouselSlotEdit?: boolean },
): boolean {
  const detected = detectImage(targetEl);
  if (!detected.isImage || !detected.imageUrl) {
    return false;
  }

  const slotPath = getMediaSlotPath(detected.imageUrl);
  if (!slotPath) {
    return false;
  }

  const devContext = extractDevContext(targetEl);
  const preciseSelector = generatePreciseSelector(targetEl);
  const imgEl = targetEl.tagName.toLowerCase() === "img" ? (targetEl as HTMLImageElement) : null;
  const occurrenceIndex = findMediaSlotDomIndex(targetEl, slotPath)
    ?? parseCollectionOccurrenceIndex(preciseSelector);
  const fallbackDevContext = devContext ?? {
    fileName: "unknown",
    componentName: "unknown",
    lineNumber: 0,
  };

  send({
    type: "OPEN_MEDIA_SLOT_DIALOG",
    slotName: slotPath,
    occurrenceIndex,
    skipPreviewScroll: options?.skipPreviewScroll,
    carouselSlotEdit: options?.carouselSlotEdit === true,
    forkContext: {
      selector: preciseSelector,
      devContext: fallbackDevContext,
      elementInfo: {
        tagName: targetEl.tagName.toLowerCase(),
        className: getElementClassName(targetEl),
        id: targetEl.id,
        selector: preciseSelector,
        devContext: fallbackDevContext,
      },
      imageInfo: {
        type: imgEl ? "img" : "background",
        currentUrl: detected.imageUrl,
        alt: imgEl?.alt || undefined,
      },
    },
  });

  return true;
}
