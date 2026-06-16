import type { AtlasLink } from '../../types/atlas-api.js';
import type { ContentLink } from '../../types/rebuild.js';

const DOCUMENT_PATH = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|csv)(\?|#|$)/i;

export function isDocumentLinkUrl(url: string): boolean {
  try {
    // pathname strips query/hash, so the (\?|#|$) tail is dead here — it only
    // matches when URL parsing fails and we fall back to the raw string below.
    return DOCUMENT_PATH.test(new URL(url, 'https://placeholder.invalid').pathname);
  } catch {
    return DOCUMENT_PATH.test(url);
  }
}

/**
 * Extract in-content document links from Atlas per-page `links`.
 * URLs are always resolved to absolute source targets (v1 keeps absolute URLs
 * for same-origin PDFs rather than path-only nav normalization).
 */
export function mapAtlasDocumentLinks(
  links: AtlasLink[] | undefined,
  pageUrl: string,
): ContentLink[] {
  if (!links?.length) return [];

  const seen = new Set<string>();
  const result: ContentLink[] = [];

  for (const link of links) {
    const label = link.text?.trim();
    const href = link.url?.trim();
    if (!label || !href || href === '#' || href.startsWith('#')) continue;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    if (!isDocumentLinkUrl(href)) continue;

    let absolute: string;
    try {
      absolute = new URL(href, pageUrl).href;
    } catch {
      continue;
    }

    if (seen.has(absolute)) continue;
    seen.add(absolute);

    result.push({
      label,
      url: absolute,
      // Prompt-only hint for target="_blank" copy; trust Atlas's isInternal
      // rather than re-deriving from the resolved host (same host can still
      // be "external" when Atlas classified a CDN/off-site document URL).
      isExternal: !link.isInternal,
    });
  }

  return result;
}
