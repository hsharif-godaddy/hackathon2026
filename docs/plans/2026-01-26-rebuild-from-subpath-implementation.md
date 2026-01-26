# Rebuild from Sub-Path Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically detect sub-path URLs and use crawl-based discovery instead of sitemap-based discovery.

**Architecture:** When a URL has a path beyond `/` (e.g., `https://showin.bio/psycholand`), use crawl-based discovery that only follows links within that path prefix. The provided URL becomes the "homepage" for analysis and slug generation.

**Tech Stack:** TypeScript, Node.js fetch API, existing SitemapDiscoveryService patterns

---

## Task 1: Add rootPath to RebuildWorkflowState

**Files:**

- Modify: `agents/src/types/rebuild.ts:173-188`

**Step 1: Add rootPath field to RebuildWorkflowState interface**

In `agents/src/types/rebuild.ts`, add the `rootPath` field to the `RebuildWorkflowState` interface:

```typescript
export interface RebuildWorkflowState {
  appId: string;
  sourceUrl: string;
  rootPath: string; // NEW: "/" for normal rebuilds, "/psycholand" for sub-path rebuilds
  status:
    | "scraping"
    | "analyzing"
    | "style_questions"
    | "building"
    | "review"
    | "complete"
    | "error";
  scrapingProgress: {
    total: number;
    completed: number;
    currentPage?: string;
  };
  stylePreferences?: StylePreferences;
  pagesBuilt: string[];
  currentPage: string | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
```

**Step 2: Run typecheck to verify no type errors**

Run: `pnpm --filter @airo/agents exec tsc --noEmit`
Expected: Success (or pre-existing errors only)

**Step 3: Commit**

```bash
git add agents/src/types/rebuild.ts
git commit -m "feat(rebuild): add rootPath to RebuildWorkflowState"
```

---

## Task 2: Add crawlFromPath method to SitemapDiscoveryService

**Files:**

- Modify: `agents/src/services/SitemapDiscoveryService.ts`

**Step 1: Add helper method to check if URL has path beyond root**

Add after line 42 (after constructor):

```typescript
/**
 * Check if URL has a path beyond the root
 *
 * @param url - URL to check
 * @returns True if URL has path segments beyond /
 */
static hasPathBeyondRoot(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.replace(/\/$/, '');
    return path.length > 0 && path !== '/';
  } catch {
    return false;
  }
}

/**
 * Extract the path prefix from a URL
 *
 * @param url - URL to extract path from
 * @returns Path prefix (e.g., "/psycholand" from "https://example.com/psycholand")
 */
static extractPathPrefix(url: string): string {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.replace(/\/$/, '');
    return path || '/';
  } catch {
    return '/';
  }
}
```

**Step 2: Add crawlFromPath method**

Add after the `discover()` method (after line 156):

```typescript
/**
 * Crawl from a specific path, only following links within the path prefix
 *
 * @param pathPrefix - The path prefix to stay within (e.g., "/psycholand")
 * @returns Promise resolving to discovery result
 */
async crawlFromPath(pathPrefix: string): Promise<SitemapDiscoveryResult> {
  try {
    logger.info('sitemap-discovery.crawl-from-path.begin', {
      baseUrl: this.baseUrl,
      pathPrefix,
      maxPages: this.maxPages
    });

    const pages: DiscoveredPage[] = [];
    const visited = new Set<string>();
    const queue: string[] = [this.baseUrl];

    while (queue.length > 0 && pages.length < this.maxPages) {
      const currentUrl = queue.shift();
      if (!currentUrl) continue;

      const normalizedUrl = this.normalizeUrl(currentUrl);
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      // Fetch and parse the page
      const links = await this.extractLinksFromPage(currentUrl);

      // Add current page to results
      pages.push({
        url: currentUrl,
        priority: currentUrl === this.baseUrl ? 1.0 : 0.5,
        source: 'crawl'
      });

      // Queue links that match the path prefix
      for (const link of links) {
        if (this.matchesPathPrefix(link, pathPrefix) && !visited.has(this.normalizeUrl(link))) {
          queue.push(link);
        }
      }
    }

    const pagesWithBlogDetection = this.detectBlogPages(pages);

    logger.info('sitemap-discovery.crawl-from-path.complete', {
      baseUrl: this.baseUrl,
      pathPrefix,
      totalPages: pagesWithBlogDetection.length
    });

    return {
      success: true,
      pages: pagesWithBlogDetection,
      totalPages: pagesWithBlogDetection.length
    };
  } catch (error) {
    logger.error('sitemap-discovery.crawl-from-path.error', {
      error: error instanceof Error ? error.message : String(error),
      baseUrl: this.baseUrl,
      pathPrefix
    });

    return {
      success: false,
      pages: [],
      totalPages: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Extract internal links from a page
 *
 * @param pageUrl - URL of the page to extract links from
 * @returns Promise resolving to array of link URLs
 */
private async extractLinksFromPage(pageUrl: string): Promise<string[]> {
  try {
    const response = await fetch(pageUrl);
    if (!response.ok) {
      logger.warn('sitemap-discovery.extract-links.failed', {
        pageUrl,
        status: response.status
      });
      return [];
    }

    const finalUrl = response.url || pageUrl;
    const finalUrlObj = new URL(finalUrl);
    const html = await response.text();
    const links: string[] = [];

    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      if (!href) continue;

      try {
        const url = new URL(href, finalUrl);
        // Only include same-hostname URLs without hash fragments
        if (url.hostname === finalUrlObj.hostname && !url.hash) {
          links.push(url.href);
        }
      } catch {
        // Ignore malformed URLs
        continue;
      }
    }

    return links;
  } catch (error) {
    logger.warn('sitemap-discovery.extract-links.error', {
      pageUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Check if a URL matches the path prefix
 *
 * @param url - URL to check
 * @param pathPrefix - Path prefix to match against
 * @returns True if URL path starts with the prefix
 */
private matchesPathPrefix(url: string, pathPrefix: string): boolean {
  try {
    const urlObj = new URL(url);
    const normalizedPath = urlObj.pathname.replace(/\/$/, '') || '/';
    const normalizedPrefix = pathPrefix.replace(/\/$/, '') || '/';

    // Root prefix matches everything on the same domain
    if (normalizedPrefix === '/') {
      return true;
    }

    // Check if path starts with prefix
    return normalizedPath === normalizedPrefix || normalizedPath.startsWith(normalizedPrefix + '/');
  } catch {
    return false;
  }
}
```

**Step 3: Run typecheck**

Run: `pnpm --filter @airo/agents exec tsc --noEmit`
Expected: Success (or pre-existing errors only)

**Step 4: Commit**

```bash
git add agents/src/services/SitemapDiscoveryService.ts
git commit -m "feat(rebuild): add crawlFromPath method to SitemapDiscoveryService"
```

---

## Task 3: Update RebuildOrchestrationService to use crawlFromPath

**Files:**

- Modify: `agents/src/services/RebuildOrchestrationService.ts`

**Step 1: Update startRebuild to set rootPath**

In `startRebuild()` method (around line 55-78), update the state initialization to include rootPath:

```typescript
async startRebuild(appId: string, sourceUrl: string): Promise<RebuildWorkflowState> {
  try {
    logger.info('rebuild-orchestration.start', {
      appId,
      sourceUrl
    });

    await mkdir(this.sourceSiteDir, { recursive: true });
    await mkdir(path.join(this.sourceSiteDir, 'pages'), { recursive: true });
    await mkdir(path.join(this.sourceSiteDir, 'screenshots'), { recursive: true });

    // Determine rootPath from sourceUrl
    const rootPath = SitemapDiscoveryService.extractPathPrefix(sourceUrl);

    const state: RebuildWorkflowState = {
      appId,
      sourceUrl,
      rootPath,  // NEW
      status: 'scraping',
      scrapingProgress: {
        total: 0,
        completed: 0
      },
      pagesBuilt: [],
      currentPage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.saveState(state);

    this.scrapeAndAnalyze(appId, sourceUrl).catch(error => {
      logger.error('rebuild-orchestration.background-error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return state;
  } catch (error) {
    logger.error('rebuild-orchestration.start-error', {
      appId,
      sourceUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
```

**Step 2: Add import for SitemapDiscoveryService static methods**

The import already exists at line 16. No changes needed.

**Step 3: Update scrapeAndAnalyze to use crawlFromPath for sub-paths**

In `scrapeAndAnalyze()` method (around line 106-131), replace the discovery logic:

```typescript
private async scrapeAndAnalyze(appId: string, sourceUrl: string): Promise<void> {
  try {
    const state = await this.getStatus(appId);

    let discoveryResult: { success: boolean; pages: Array<{ url: string; priority?: number; source: string; isBlog?: boolean }>; totalPages: number };

    // Choose discovery method based on whether URL has a path beyond root
    if (SitemapDiscoveryService.hasPathBeyondRoot(sourceUrl)) {
      // Sub-path mode: crawl-based discovery with path prefix filtering
      const pathPrefix = SitemapDiscoveryService.extractPathPrefix(sourceUrl);
      logger.info('rebuild-orchestration.sub-path-mode', {
        appId,
        sourceUrl,
        pathPrefix
      });

      const sitemapService = new SitemapDiscoveryService(sourceUrl, MAX_PAGES_TO_SCRAPE);
      discoveryResult = await sitemapService.crawlFromPath(pathPrefix);
    } else {
      // Root mode: existing sitemap-based discovery
      logger.info('rebuild-orchestration.root-mode', {
        appId,
        sourceUrl
      });

      const sitemapService = new SitemapDiscoveryService(sourceUrl, MAX_PAGES_TO_SCRAPE);
      discoveryResult = await sitemapService.discover();
    }

    if (!discoveryResult.success || discoveryResult.pages.length === 0) {
      throw new Error('Failed to discover pages');
    }

    // Rest of the method continues unchanged...
```

**Step 4: Update isHomepage to use rootPath**

Replace the `isHomepage()` method (around line 644-651):

```typescript
/**
 * Check if URL is the homepage (root of the rebuild)
 *
 * @param url - URL to check
 * @param rootPath - Root path for this rebuild (default: "/")
 * @returns True if this is the homepage
 */
private isHomepage(url: string, rootPath: string = '/'): boolean {
  try {
    const urlObj = new URL(url);
    const normalizedPath = urlObj.pathname.replace(/\/$/, '') || '/';
    const normalizedRoot = rootPath.replace(/\/$/, '') || '/';
    return normalizedPath === normalizedRoot;
  } catch {
    return false;
  }
}
```

**Step 5: Update the call to isHomepage in scrapeAndAnalyze**

Find where `isHomepage()` is called (around line 230) and update it to pass rootPath:

```typescript
const homePage = multiPageResult.pages.find(
  (p) => p.success && this.isHomepage(p.url, state.rootPath),
);
```

**Step 6: Update urlToSlug to handle rootPath**

Replace the `urlToSlug()` method (around line 623-636):

```typescript
/**
 * Convert URL to slug
 *
 * @param url - URL to convert
 * @param rootPath - Root path for this rebuild (default: "/")
 * @returns Slug
 */
private urlToSlug(url: string, rootPath: string = '/'): string {
  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname.replace(/^\/|\/$/g, '');

    // Remove root path prefix for sub-path rebuilds
    const rootPrefix = rootPath.replace(/^\/|\/$/g, '');
    if (rootPrefix && pathname.startsWith(rootPrefix)) {
      pathname = pathname.slice(rootPrefix.length).replace(/^\//, '');
    }

    if (!pathname || pathname === '') {
      return 'homepage';
    }

    return pathname.replace(/\//g, '-');
  } catch {
    return 'page';
  }
}
```

**Step 7: Update all calls to urlToSlug to pass rootPath**

Find calls to `urlToSlug()` and update them. In `savePage()` (line 517) and `scrapeAndAnalyze()` where sitemap is created (line 184):

For `savePage()`:

```typescript
private async savePage(page: { url: string; sanitizedContent?: string; html?: string; screenshotBase64?: string }, rootPath: string = '/'): Promise<void> {
  const slug = this.urlToSlug(page.url, rootPath);
  // ... rest unchanged
}
```

For sitemap creation in `scrapeAndAnalyze()`:

```typescript
const sitemapData: SitemapData = {
  pages: discoveryResult.pages.map((p) => ({
    url: p.url,
    slug: this.urlToSlug(p.url, state.rootPath),
    // ... rest unchanged
  })),
  // ...
};
```

And update the call to `savePage()`:

```typescript
await this.savePage(
  {
    url: page.url,
    sanitizedContent: page.sanitizedContent,
    html: page.html,
    screenshotBase64: page.screenshotBase64,
  },
  state.rootPath,
);
```

**Step 8: Run typecheck**

Run: `pnpm --filter @airo/agents exec tsc --noEmit`
Expected: Success (or pre-existing errors only)

**Step 9: Commit**

```bash
git add agents/src/services/RebuildOrchestrationService.ts
git commit -m "feat(rebuild): use crawlFromPath for sub-path URLs"
```

---

## Task 4: Update rebuild-page-selector to use rootPath for display

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/rebuild-page-selector.ts`

**Step 1: Update title generation to use rootPath-aware slugs**

In the `rebuildPageSelectorAITool` (around line 136-143), the available pages display uses slugs. Update to generate cleaner titles for sub-path rebuilds:

```typescript
// Get available pages (scraped but not built, excluding homepage)
const availablePages = sitemap.pages
  .filter((p) => p.scraped)
  .map((p) => ({
    slug: p.slug,
    title:
      p.slug === "homepage"
        ? "Homepage"
        : p.slug.charAt(0).toUpperCase() + p.slug.slice(1).replace(/-/g, " "),
    url: p.url,
    isBuilt: workflowState.pagesBuilt.includes(p.slug),
  }));
```

This already works correctly because `urlToSlug()` now generates clean slugs relative to rootPath. The homepage slug is "homepage" regardless of the actual path, and child pages get clean slugs like "about" instead of "psycholand-about".

No changes needed to this file - the slug generation in RebuildOrchestrationService handles the complexity.

**Step 2: Commit (skip if no changes)**

No commit needed for this task.

---

## Task 5: Manual Testing

**Step 1: Test root URL (existing behavior)**

Start the dev server and test with a root URL like `https://example.com`. Verify:

- Sitemap-based discovery is used
- Homepage is detected at `/`
- Slugs are generated correctly

**Step 2: Test sub-path URL (new behavior)**

Test with a sub-path URL like `https://showin.bio/psycholand`. Verify:

- Crawl-based discovery is used
- Only pages under `/psycholand/` are discovered
- The provided URL is treated as homepage
- Slugs are relative to the sub-path (e.g., `/psycholand/about` becomes "about", not "psycholand-about")

**Step 3: Verify site analysis uses correct "homepage"**

For sub-path rebuilds, verify that brand/color analysis is performed on the sub-path root, not the domain root.

---

## Summary of Changes

| File                                                 | Changes                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `agents/src/types/rebuild.ts`                        | Add `rootPath` field to `RebuildWorkflowState`                                                                       |
| `agents/src/services/SitemapDiscoveryService.ts`     | Add `hasPathBeyondRoot()`, `extractPathPrefix()`, `crawlFromPath()`, `extractLinksFromPage()`, `matchesPathPrefix()` |
| `agents/src/services/RebuildOrchestrationService.ts` | Update `startRebuild()`, `scrapeAndAnalyze()`, `isHomepage()`, `urlToSlug()`, `savePage()` to handle rootPath        |
