import { detectImage, getMediaSlotPath } from "./element-detection";
import { getCarouselSlotEditRoot, isCarouselSlotEditActive } from "./carousel-slot-edit";
import { openMediaSlotDialogForElement } from "./open-media-slot-dialog";

export function getCarouselSlideAtIndex(
  carouselRoot: HTMLElement,
  index: number,
): HTMLElement | null {
  const slides = carouselRoot.querySelectorAll('[aria-roledescription="slide"]');
  return (slides[index] as HTMLElement | undefined) ?? null;
}

export function findMediaSlotElementInSlide(slideEl: HTMLElement): HTMLElement | null {
  for (const candidate of slideEl.querySelectorAll("img, video")) {
    if (
      candidate instanceof HTMLImageElement
      && candidate.getAttribute("data-airo-video-patched")
    ) {
      continue;
    }
    const info = detectImage(candidate as HTMLElement);
    if (info.isImage && info.imageUrl && getMediaSlotPath(info.imageUrl) && info.imageElement) {
      return info.imageElement;
    }
  }

  for (const candidate of slideEl.querySelectorAll("section, div")) {
    const info = detectImage(candidate as HTMLElement);
    if (info.isImage && info.imageUrl && getMediaSlotPath(info.imageUrl) && info.imageElement) {
      return info.imageElement;
    }
  }

  return null;
}

export function syncMediaPanelToCarouselSlide(selectedIndex: number): void {
  if (!isCarouselSlotEditActive()) {
    return;
  }

  const carouselRoot = getCarouselSlotEditRoot();
  if (!carouselRoot) {
    return;
  }

  const slide = getCarouselSlideAtIndex(carouselRoot, selectedIndex);
  if (!slide) {
    return;
  }

  const mediaEl = findMediaSlotElementInSlide(slide);
  if (!mediaEl) {
    return;
  }

  openMediaSlotDialogForElement(mediaEl, { skipPreviewScroll: true });
}

export function bindCarouselSlotPanelSync(): () => void {
  const onCarouselSlotSelect = (event: Event): void => {
    const detail = (event as CustomEvent<{
      carouselRoot?: HTMLElement
      selectedIndex?: number
    }>).detail;
    if (!detail?.carouselRoot || detail.carouselRoot !== getCarouselSlotEditRoot()) {
      return;
    }
    if (typeof detail.selectedIndex !== "number") {
      return;
    }
    syncMediaPanelToCarouselSlide(detail.selectedIndex);
  };

  window.addEventListener("airo:carousel-slot-select", onCarouselSlotSelect);
  return () => window.removeEventListener("airo:carousel-slot-select", onCarouselSlotSelect);
}
