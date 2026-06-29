import type { CapturedSite } from '../../clients/site-capture/types.js';
import type { DOMSnapshot } from '../../runner/transcript.js';

/** Visible text length below which a page is considered blank/thin. */
export const MIN_CONTENT_CHARS = 40;

/** Strip scripts/styles/tags and collapse whitespace; return char count. */
export function visibleTextLength(html: string): number {
  const stripped = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length;
}

/**
 * "The build produced a real, non-blank site." Checks RenderedSignals
 * (title/h1/heading/body across all routes) first, then falls back to
 * snapshot HTML visible-text length. The fallback is the capture-timing-
 * robust fix from the contact-page pilot (v3): RenderedSignals came back
 * empty on fully-rendered pages, causing false fails — reading the
 * snapshot HTML sees the real content the rendered summary missed.
 *
 * Shared across scenario expectation fixtures so a threshold/logic change
 * lands in one place (PR #5147 review: was duplicated 3x).
 */
export function hasRenderedContent(
  site: CapturedSite,
  snapshots: DOMSnapshot[],
): boolean {
  const renderedHasCopy = site.perRoute.some((rc) => {
    const r = rc.rendered;
    if (!r) return false;
    return /\w[\w\s]{11,}/.test(
      `${r.title} ${r.h1 ?? ''} ${r.headingText} ${r.bodyPreview}`,
    );
  });
  if (renderedHasCopy) return true;
  return snapshots.some(
    (s) => s.html !== undefined && visibleTextLength(s.html) >= MIN_CONTENT_CHARS,
  );
}
