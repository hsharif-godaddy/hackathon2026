/**
 * Builds the `CONTENT_UPDATED` message payload for a content-keyed inline edit.
 *
 * Pure and side-effect-free so the *producer* of the `expectedCurrent` guard can
 * be tested in isolation (the hook that calls it opens only on a trusted click,
 * which jsdom can't synthesize). This function decides whether the server-side
 * derived-mismatch guard ever engages: a derived node (`data-dev-content-derived`)
 * carries `expectedCurrent` (the text the user started from) so the server can
 * refuse a save when the stored value no longer matches; a non-derived node omits
 * it entirely, leaving the normal content-edit path unchanged.
 */
export interface ContentEditTarget {
  key: string;
  kind: "copy" | "richText";
}

export interface ContentUpdatePayload {
  contentKey: string;
  kind: "copy" | "richText";
  oldText: string;
  newText: string;
  expectedCurrent?: string;
}

export function buildContentUpdatePayload(
  element: HTMLElement,
  target: ContentEditTarget,
  originalText: string,
  newText: string,
): ContentUpdatePayload {
  const isDerived: boolean = element.getAttribute("data-dev-content-derived") === "true";
  return {
    contentKey: target.key,
    kind: target.kind,
    oldText: originalText,
    newText,
    ...(isDerived ? { expectedCurrent: originalText } : {}),
  };
}
