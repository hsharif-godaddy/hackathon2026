export function formatSlotName(slot: string): string {
  return slot
    .split('/')
    .filter(
      (part) =>
        part &&
        part !== 'pages' &&
        part !== 'components' &&
        part !== 'sections' &&
        part !== 'layouts'
    )
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
    .join(' ');
}

/** Forked carousel slots like pages/home/hero-4 → "Slide Image 4". */
export function formatCarouselSlideImageLabel(slot: string): string | null {
  const lastSegment = slot.split('/').filter(Boolean).at(-1);
  if (!lastSegment) return null;
  const match = lastSegment.match(/-(\d+)$/);
  if (!match) return null;
  return `Slide Image ${match[1]}`;
}

export function formatMediaPanelSlotTitle(
  slot: string,
  options?: { fromPreviewReplace?: boolean },
): string {
  if (options?.fromPreviewReplace) {
    const carouselLabel = formatCarouselSlideImageLabel(slot);
    if (carouselLabel) return carouselLabel;
  }
  return formatSlotName(slot);
}
