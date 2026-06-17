/**
 * Whether a slot swap should fork instead of updating in place.
 * Shared when multiple source references exist, or when the clicked element's
 * source location differs from the manifest slot's sourceRef.
 */
export function isSharedSlotReference(
  refCount: number,
  clickSourceRef: string | null | undefined,
  slotSourceRef: string | null | undefined,
): boolean {
  if (refCount > 1) {
    return true;
  }
  if (!clickSourceRef || slotSourceRef == null) {
    return false;
  }
  return slotSourceRef !== clickSourceRef;
}

/**
 * Derive a 0-based collection index from a precise nth-child selector.
 * Uses the parent segment immediately before the target img/video element.
 * Prefer DOM-based index matching when available — this is unreliable for
 * repeated card wrappers where every item's immediate parent is :nth-child(1).
 */
export function parseCollectionOccurrenceIndex(selector: string): number | null {
  const segments = selector.split(' > ').filter(Boolean);
  for (let i = segments.length - 2; i >= 0; i--) {
    const match = segments[i]?.match(/:nth-child\((\d+)\)/);
    if (!match?.[1]) {
      continue;
    }
    const index = parseInt(match[1], 10);
    if (index > 0) {
      return index - 1;
    }
  }
  return null;
}
