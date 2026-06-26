/**
 * Shared URL utilities for the rebuild pipeline.
 * Used by both RebuildOrchestrationService and AtlasCrawlerAdapter.
 */

import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'rebuild-utils' });

export function isRebuildHomepage(url: string, rootPath: string = '/'): boolean {
  try {
    const urlObj = new URL(url);
    const normalizedPath = urlObj.pathname.replace(/\/$/, '') || '/';
    const normalizedRoot = rootPath.replace(/\/$/, '') || '/';
    return normalizedPath === normalizedRoot;
  } catch {
    return false;
  }
}

export function rebuildUrlToSlug(url: string, rootPath: string = '/'): string {
  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname.replace(/^\/|\/$/g, '');

    // Remove root path prefix for sub-path rebuilds. Use a path-segment
    // boundary check so /foobar isn't treated as a child of /foo.
    const rootPrefix = rootPath.replace(/^\/|\/$/g, '');
    if (rootPrefix && (pathname === rootPrefix || pathname.startsWith(rootPrefix + '/'))) {
      pathname = pathname.slice(rootPrefix.length).replace(/^\//, '');
    } else if (rootPrefix && pathname !== rootPrefix) {
      // URL doesn't match expected rootPath prefix - log for debugging
      logger.warn('rebuild-utils.slug-prefix-mismatch', {
        url,
        pathname,
        rootPath,
        message: 'URL does not start with expected rootPath prefix'
      });
    }

    if (!pathname || pathname === '') {
      return 'homepage';
    }

    return pathname.replace(/\//g, '-');
  } catch {
    return 'page';
  }
}

export function detectBlogPage(url: string): boolean {
  const blogPatterns = ['/blog', '/posts', '/articles', '/news', '/journal'];
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return blogPatterns.some(pattern => pathname.includes(pattern));
  } catch {
    return false;
  }
}

export function normalizeRebuildPageKey(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    const path = u.pathname.replace(/\/$/, '') || '/';
    return `${u.origin}${path}`;
  } catch {
    return pageUrl;
  }
}

export function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The sentinel value produced by extractTitle when no heading is found. */
export const UNTITLED_PAGE_TITLE = 'Untitled Page';

/** Pick a human title: the extracted page title, unless it's the generic
 * fallback, in which case derive from the slug. */
export function resolvePageTitle(extractedTitle: string | undefined, slug: string): string {
  return (extractedTitle && extractedTitle !== UNTITLED_PAGE_TITLE) ? extractedTitle : slugToTitle(slug);
}

/**
 * Normalizes logo URLs by removing size suffixes, query parameters, and fragments.
 * Used by both AtlasCrawlerAdapter and RebuildOrchestrationService to ensure
 * consistent URL matching when finding higher-resolution logo variants.
 *
 * Examples:
 * - "https://img1.wsimg.com/isteam/ip/abc/logo.png/:/rs=w:16,h:16,m" → "https://img1.wsimg.com/isteam/ip/abc/logo.png"
 * - "https://img1.wsimg.com/isteam/ip/abc/logo.png/:/cr=t:12.5%25,l:0%25,w:100%25,h:75%25" → "https://img1.wsimg.com/isteam/ip/abc/logo.png"
 * - "https://example.com/logo.png?v=123#section" → "https://example.com/logo.png"
 */
export function normalizeLogoUrl(url: string): string {
  // Remove size suffix pattern: /:/rs=w:X,h:Y,m or /:/cr=... (case-insensitive)
  // Use [^/]+ to match parameters within the segment, not across path separators
  let normalized: string = url.replace(/\/:\/(rs|cr)=[^/]+$/i, '');

  // Remove query parameters
  normalized = normalized.split('?')[0] ?? normalized;

  // Remove fragment identifiers
  normalized = normalized.split('#')[0] ?? normalized;

  return normalized;
}
