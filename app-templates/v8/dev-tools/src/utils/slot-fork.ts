/**
 * Keep in sync with packages/shared/src/media/slot-fork.ts.
 */

/** Derive a 0-based collection index from a precise nth-child selector.
 *  Prefer findMediaSlotDomIndex — this reads the immediate parent nth-child,
 *  which is often :nth-child(1) inside every repeated card wrapper. */
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
