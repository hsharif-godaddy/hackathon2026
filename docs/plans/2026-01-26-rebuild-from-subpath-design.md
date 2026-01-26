# Rebuild from Sub-Path Design

## Overview

Automatically detect when a user provides a URL with a path (like `https://showin.bio/psycholand`) and use crawl-based discovery instead of sitemap-based discovery. This enables rebuilding sites where users have their own sub-section of a larger platform.

## Behavior

- URLs without path (`https://example.com`) → Current sitemap-based discovery
- URLs with path (`https://example.com/psycholand`) → Crawl-based discovery with path prefix filtering

### Example

```
Input: https://showin.bio/psycholand

Discovered pages:
✓ /psycholand (treated as "homepage")
✓ /psycholand/about
✓ /psycholand/gallery
✓ /psycholand/contact
✗ /other-user (different path prefix)
✗ /about (root level, outside prefix)
```

The provided URL becomes the "homepage" for all purposes - site analysis, first page built, brand extraction.

## Discovery Logic Changes

New logic in `RebuildOrchestrationService.scrapeAndAnalyze()`:

```typescript
if (hasPathBeyondRoot(sourceUrl)) {
  // Sub-path mode: crawl-based discovery
  pages = await sitemapService.crawlFromPath(sourceUrl, {
    pathPrefix: extractPathPrefix(sourceUrl),
    maxPages: 20,
  });
} else {
  // Root mode: existing sitemap-based discovery
  pages = await sitemapService.discover();
}
```

### Path Prefix Extraction

- `https://showin.bio/psycholand` → prefix: `/psycholand`
- `https://example.com/users/john/portfolio` → prefix: `/users/john/portfolio`

### Crawl Algorithm

1. Scrape the starting URL
2. Extract all internal links from the page
3. Filter to links matching the path prefix
4. Add matching links to queue (up to maxPages limit)
5. Repeat for each queued page

## Homepage Handling

Track the "root URL" in workflow state:

```typescript
// workflow-state.json gains a new field
{
  appId: string,
  sourceUrl: string,
  rootPath: string,  // NEW: "/psycholand" or "/" for normal rebuilds
  status: 'scraping',
  // ... rest unchanged
}
```

Update `isHomepage()` to be context-aware:

```typescript
// Before
private isHomepage(url: string): boolean {
  const urlObj = new URL(url);
  return urlObj.pathname === '/' || urlObj.pathname === '';
}

// After
private isHomepage(url: string, rootPath: string): boolean {
  const urlObj = new URL(url);
  const normalizedPath = urlObj.pathname.replace(/\/$/, '') || '/';
  return normalizedPath === rootPath;
}
```

Site analysis uses the root URL - the page matching `rootPath` gets passed to `SiteAnalyzerAgent` for brand/color extraction.

## Slug Generation

Sub-path mode generates clean slugs relative to the root:

- `/psycholand` (root) → `"homepage"`
- `/psycholand/about` → `"about"`
- `/psycholand/gallery/photos` → `"gallery-photos"`

```typescript
private urlToSlug(url: string, rootPath: string = '/'): string {
  const urlObj = new URL(url);
  let pathname = urlObj.pathname.replace(/^\/|\/$/g, '');

  // Remove root path prefix for sub-path rebuilds
  const rootPrefix = rootPath.replace(/^\/|\/$/g, '');
  if (rootPrefix && pathname.startsWith(rootPrefix)) {
    pathname = pathname.slice(rootPrefix.length).replace(/^\//, '');
  }

  if (!pathname) {
    return 'homepage';
  }

  return pathname.replace(/\//g, '-');
}
```

## Crawl Implementation

New method in `SitemapDiscoveryService`:

```typescript
async crawlFromPath(
  startUrl: string,
  pathPrefix: string,
  maxPages: number = 20
): Promise<DiscoveryResult> {
  const discovered: DiscoveredPage[] = [];
  const visited = new Set<string>();
  const queue = [startUrl];

  while (queue.length > 0 && discovered.length < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    // Fetch page and extract links
    const links = await this.extractLinksFromPage(url);

    // Add current page to results
    discovered.push({
      url,
      priority: url === startUrl ? 1.0 : 0.5,
      source: 'crawl'
    });

    // Queue links matching path prefix
    for (const link of links) {
      if (this.matchesPathPrefix(link, pathPrefix) && !visited.has(link)) {
        queue.push(link);
      }
    }
  }

  return { success: true, pages: discovered, totalPages: discovered.length };
}
```

Link extraction reuses existing scraper infrastructure - fetch page HTML, parse anchor tags, resolve relative URLs, filter to same domain.

## Files to Modify

### Primary Changes

| File                                                 | Change                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `agents/src/services/SitemapDiscoveryService.ts`     | Add `crawlFromPath()` method                                           |
| `agents/src/services/RebuildOrchestrationService.ts` | Detect sub-path URLs, call crawl vs sitemap, track `rootPath` in state |
| `agents/src/types/rebuild.ts`                        | Add `rootPath` to `RebuildWorkflowState`                               |

### Secondary Changes

| File                                                     | Change                                            |
| -------------------------------------------------------- | ------------------------------------------------- |
| `agents/src/tools/ai-lib-tools/rebuild-page-selector.ts` | Pass `rootPath` when generating slugs for display |

### No Changes Needed

- `AssetProcessingService` - works with URLs as-is
- `SiteAnalyzerAgent` - receives page content, doesn't care about paths
- `PagePromptAgent` - receives page content, doesn't care about paths
- `WebsiteScraperDriver` - already supports scraping any URL
