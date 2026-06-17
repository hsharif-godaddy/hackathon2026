import { getMediaSlotPath } from "./element-detection";

function elementDisplaysSlot(element: HTMLElement, slotPath: string): boolean {
  if (element.tagName.toLowerCase() === "img") {
    const img = element as HTMLImageElement;
    const src = img.src || img.getAttribute("src") || "";
    return getMediaSlotPath(src) === slotPath;
  }

  if (element.tagName.toLowerCase() === "video") {
    const video = element as HTMLVideoElement;
    const src = video.src || video.getAttribute("src") || "";
    return getMediaSlotPath(src) === slotPath || video.getAttribute("data-slot") === slotPath;
  }

  if (element.getAttribute("data-airo-video-bg-patched") === slotPath) {
    return true;
  }

  const bgImage = window.getComputedStyle(element).backgroundImage;
  if (bgImage && bgImage !== "none") {
    const imagePattern = `/airo-assets/images/${slotPath}`;
    const videoPattern = `/airo-assets/videos/${slotPath}`;
    return bgImage.includes(imagePattern) || bgImage.includes(videoPattern);
  }

  return false;
}

/** Collect DOM elements that currently display a given media slot path. */
export function collectMediaSlotDomMatches(slotPath: string): HTMLElement[] {
  const matches: HTMLElement[] = [];

  document.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    if (img.getAttribute("data-airo-video-patched")) {
      return;
    }
    const src = img.src || img.getAttribute("src") || "";
    if (getMediaSlotPath(src) === slotPath) {
      matches.push(img);
    }
  });

  document.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
    const src = video.src || video.getAttribute("src") || "";
    const dataSlot = video.getAttribute("data-slot");
    if (getMediaSlotPath(src) === slotPath || dataSlot === slotPath) {
      matches.push(video);
    }
  });

  document.querySelectorAll<HTMLElement>('[style*="background"], [data-airo-video-bg-patched]').forEach((el) => {
    if (elementDisplaysSlot(el, slotPath)) {
      matches.push(el);
    }
  });

  document.querySelectorAll<HTMLElement>("section, div, header, main").forEach((el) => {
    if (matches.includes(el)) {
      return;
    }
    if (elementDisplaysSlot(el, slotPath)) {
      matches.push(el);
    }
  });

  return matches;
}

/** 0-based index of an element among all DOM instances of a media slot. */
export function findMediaSlotDomIndex(element: HTMLElement, slotPath: string): number | null {
  const matches = collectMediaSlotDomMatches(slotPath);
  let current: HTMLElement | null = element;
  while (current) {
    const index = matches.indexOf(current);
    if (index >= 0) {
      return index;
    }
    current = current.parentElement;
  }
  return null;
}
