/**
 * Persistence layer for the rebuild flow's `.source-site/` directory.
 *
 * Owns the on-disk shape: pages/<slug>.json + .html, screenshots/<slug>.png,
 * site-metadata.json, sitemap.json, and reading the assets manifest. Pure I/O
 * — no scrape logic, no LLM calls, no workflow-state mutation.
 *
 * Round-trip invariants are tested in
 * `__tests__/RebuildOrchestrationService.test.ts` ("persistence round-trip").
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Logger } from '../../logging/index.js';
import { detectInteractivePatterns } from '../interactive-pattern-detector.js';
import {
  type AssetManifest,
  type FormHint,
  type NavigationItem,
  type PageContent,
  type PageMetadata,
  type SiteMetadata,
  type SitemapData,
  type SourceSiteData,
} from '../../types/rebuild.js';

const logger = Logger.create({ component: 'rebuild-orchestration-service' });

export interface SavePageInput {
  url: string;
  sanitizedContent?: string;
  html?: string;
  screenshotBase64?: string;
  forms?: FormHint[];
  metadata?: PageMetadata;
}

export class PagePersistenceService {
  private sourceSiteDir: string;

  constructor(sourceSiteDir: string) {
    this.sourceSiteDir = sourceSiteDir;
  }

  async saveMetadata(metadata: SiteMetadata): Promise<void> {
    const metadataPath = path.join(this.sourceSiteDir, 'site-metadata.json');
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  async saveSitemap(sitemap: SitemapData): Promise<void> {
    const sitemapPath = path.join(this.sourceSiteDir, 'sitemap.json');
    await writeFile(sitemapPath, JSON.stringify(sitemap, null, 2), 'utf-8');
  }

  /**
   * Persist a single scraped page. Writes:
   *   - pages/<slug>.json — typed PageContent
   *   - pages/<slug>.html — raw HTML (when present)
   *   - screenshots/<slug>.png — PNG (when base64 data URL present)
   *
   * Pattern detection + form attachment are gated on `useAtlas` because the
   * legacy scraper doesn't produce structured forms, and the detector's
   * outputs feed Atlas-only downstream behavior. Caller controls the gate.
   */
  async savePage(
    page: SavePageInput,
    slug: string,
    navigation: NavigationItem[],
    useAtlas: boolean,
  ): Promise<void> {
    const title = extractTitle(page.sanitizedContent || '');
    if (useAtlas && !page.html) {
      logger.warn('rebuild-orchestration.atlas-missing-html', {
        url: page.url,
        slug,
        message: 'Atlas page returned without raw HTML; pattern detection will be skipped',
      });
    }
    const interactivePatterns = useAtlas ? detectInteractivePatterns(page.html) : [];
    const forms = useAtlas ? (page.forms ?? []) : [];

    const pageContent: PageContent = {
      url: page.url,
      slug,
      // title from extractTitle(<h1>) — may differ from metadata.title (Atlas <title> tag)
      title,
      content: page.sanitizedContent || '',
      sanitizedContent: page.sanitizedContent || '',
      structure: {
        hasHeader: true,
        hasFooter: true,
        hasSidebar: false,
        sections: [],
        navigation,
        ...(interactivePatterns.length > 0 ? { interactivePatterns } : {}),
        ...(forms.length > 0 ? { forms } : {}),
      },
      metadata: page.metadata ?? { title },
      scrapedAt: new Date().toISOString(),
    };

    if (interactivePatterns.length > 0) {
      logger.debug('rebuild-orchestration.interactive-patterns-detected', {
        url: page.url,
        slug,
        patterns: interactivePatterns.map(p => `${p.type}(${p.occurrences})`),
      });
    }

    if (forms.length > 0) {
      logger.debug('rebuild-orchestration.forms-detected', {
        url: page.url,
        slug,
        formCount: forms.length,
        summary: forms.map(f => `${f.method.toUpperCase()}->${f.action ?? '(no action)'} (${f.fields.length} fields)`),
      });
    }

    const pagePath = path.join(this.sourceSiteDir, 'pages', `${slug}.json`);
    await writeFile(pagePath, JSON.stringify(pageContent, null, 2), 'utf-8');

    if (page.html) {
      const htmlPath = path.join(this.sourceSiteDir, 'pages', `${slug}.html`);
      await writeFile(htmlPath, page.html, 'utf-8');
    }

    if (page.screenshotBase64) {
      const screenshotPath = path.join(this.sourceSiteDir, 'screenshots', `${slug}.png`);
      const base64Data = page.screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      await writeFile(screenshotPath, Buffer.from(base64Data, 'base64'));
    }
  }

  async loadSourceSiteData(): Promise<SourceSiteData> {
    const metadataPath = path.join(this.sourceSiteDir, 'site-metadata.json');
    const sitemapPath = path.join(this.sourceSiteDir, 'sitemap.json');
    const assetManifestPath = path.join(this.sourceSiteDir, 'assets', 'manifest.json');

    const metadata: SiteMetadata = JSON.parse(await readFile(metadataPath, 'utf-8'));
    const sitemap: SitemapData = JSON.parse(await readFile(sitemapPath, 'utf-8'));

    let assets: AssetManifest = {
      assets: [],
      totalAssets: 0,
      byType: { image: 0, font: 0, icon: 0, other: 0 },
      generatedAt: new Date().toISOString(),
    };

    try {
      assets = JSON.parse(await readFile(assetManifestPath, 'utf-8'));
    } catch {
      logger.warn('rebuild-orchestration.no-assets', { message: 'Asset manifest not found' });
    }

    const scrapedSlugs = sitemap.pages.filter(p => p.scraped).map(p => p.slug);
    const loaded = await Promise.all(
      scrapedSlugs.map(async slug => {
        try {
          const pagePath = path.join(this.sourceSiteDir, 'pages', `${slug}.json`);
          const data = JSON.parse(await readFile(pagePath, 'utf-8')) as PageContent;
          return [slug, data] as const;
        } catch {
          return null;
        }
      }),
    );

    const pages: Record<string, PageContent> = {};
    for (const entry of loaded) {
      if (entry) {
        pages[entry[0]] = entry[1];
      }
    }

    return { metadata, sitemap, pages, assets };
  }

  async getAssetManifest(): Promise<AssetManifest | null> {
    const assetManifestPath = path.join(this.sourceSiteDir, 'assets', 'manifest.json');
    try {
      return JSON.parse(await readFile(assetManifestPath, 'utf-8'));
    } catch {
      return null;
    }
  }
}

/** Extract a page title from sanitized HTML content. Falls back to "Untitled Page". */
export function extractTitle(content: string): string {
  const h1Match = content.match(/<h1[^>]*>(.*?)<\/h1>/i);
  if (h1Match && h1Match[1]) {
    return h1Match[1].replace(/<[^>]+>/g, '').trim();
  }
  const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }
  return 'Untitled Page';
}

/**
 * Extract navigation items from the first <nav> block in the HTML.
 * Filters out fragments, empty hrefs, and self-referential `/` links.
 * External hosts kept as-is; internal hrefs collapsed to pathname.
 */
export function extractNavigationFromHtml(html: string | undefined, pageUrl: string): NavigationItem[] {
  if (!html) return [];

  const navBlockRegex = /<nav[^>]*>([\s\S]*?)<\/nav>/gi;
  const seen = new Set<string>();
  const items: NavigationItem[] = [];

  let navMatch: RegExpExecArray | null;
  while ((navMatch = navBlockRegex.exec(html)) !== null) {
    const navHtml = navMatch[1] ?? '';
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(navHtml)) !== null) {
      const href = linkMatch[1] ?? '';
      const text = (linkMatch[2] ?? '').replace(/<[^>]+>/g, '').trim();

      if (!text || text.length > 50) continue;
      if (href === '#' || href.startsWith('#') || href === '/') continue;

      let resolvedPath: string;
      try {
        const resolved = new URL(href, pageUrl);
        const pageOrigin = new URL(pageUrl).origin;
        if (resolved.origin !== pageOrigin) {
          if (!seen.has(href)) {
            seen.add(href);
            items.push({ label: text, url: href, isExternal: true });
          }
          continue;
        }
        resolvedPath = resolved.pathname.replace(/\/$/, '') || '/';
      } catch {
        resolvedPath = href;
      }

      if (resolvedPath === '/' || seen.has(resolvedPath)) continue;
      seen.add(resolvedPath);

      items.push({ label: text, url: resolvedPath, isExternal: false });
    }

    if (items.length > 0) break;
  }

  return items.slice(0, 15);
}
