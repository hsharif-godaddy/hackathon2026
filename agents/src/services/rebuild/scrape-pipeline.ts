/**
 * Two-strategy scrape + analyze pipeline for the rebuild flow.
 *
 * Owns the body of `scrapeAndAnalyze`: legacy path uses
 * `WebsiteScraperDriver` + `SitemapDiscoveryService`, Atlas path uses
 * `AtlasCrawlerAdapter`. Both converge on `persistScrapedPages` →
 * `SiteAnalyzerAgent.analyze` → `AssetProcessingService.process`.
 *
 * Workflow-state mutation (status transitions, scrapingProgress, error
 * recording) is done via callbacks (`getStatus` / `saveState`) supplied by
 * the orchestrator — the pipeline doesn't own the workflow-state file.
 */
import { SiteAnalyzerAgent } from '../../agents/site-analyzer-agent.js';
import { Logger } from '../../logging/index.js';
import type { PageScrapeResult } from '../../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import { WebsiteScraperDriver } from '../../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import {
  asRebuildError,
  createRebuildError,
  type NavigationItem,
  type RebuildWorkflowState,
  type SiteMetadata,
  type SitemapData,
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
} from '../../types/rebuild.js';
import { isRebuildHomepage, normalizeRebuildPageKey, rebuildUrlToSlug } from '../../utils/rebuild-utils.js';
import { AssetProcessingService } from '../AssetProcessingService.js';
import { AtlasCrawlerAdapter } from '../AtlasCrawlerAdapter.js';
import { SitemapDiscoveryService, type SitemapDiscoveryResult } from '../SitemapDiscoveryService.js';

const logger = Logger.create({ component: 'rebuild-orchestration-service' });

/** Default page cap. Atlas + legacy both honor it. */
export const MAX_PAGES_TO_SCRAPE = 20;

function readRebuildScrapeBatchDelayMs(): number {
  const raw = process.env.REBUILD_SCRAPE_BATCH_DELAY_MS;
  if (raw === undefined || raw === '') return 600;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 600;
}

function readRebuildScrapeConcurrency(): number | undefined {
  const raw = process.env.REBUILD_SCRAPE_CONCURRENCY;
  if (raw === undefined || raw === '') return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

function dedupeExtractedAssetRows<T extends { url: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

/**
 * Bucket assets for the post-scrape processing pass. Both Atlas and legacy
 * paths build the same `assetMap` (url → sourceUrls) and split assets into
 * home/other arrays — keep that shared shape here so the two scrape branches
 * don't drift apart.
 *
 * Note: callers may dedupe the buckets before processing. Legacy does;
 * Atlas's adapter already produces a deduped asset stream so the atlas path
 * does not. This helper preserves that asymmetry by returning raw arrays.
 */
export function bucketAssetsForProcessing<T extends { url: string; sourceUrl: string }>(
  assets: T[],
  homePageUrl: string,
): { assetMap: Map<string, string[]>; homeAssets: T[]; otherAssets: T[] } {
  const assetMap = new Map<string, string[]>();
  for (const asset of assets) {
    if (!assetMap.has(asset.url)) {
      assetMap.set(asset.url, []);
    }
    assetMap.get(asset.url)!.push(asset.sourceUrl);
  }
  const homeKey = normalizeRebuildPageKey(homePageUrl);
  const homeAssets: T[] = [];
  const otherAssets: T[] = [];
  for (const asset of assets) {
    if (normalizeRebuildPageKey(asset.sourceUrl) === homeKey) homeAssets.push(asset);
    else otherAssets.push(asset);
  }
  return { assetMap, homeAssets, otherAssets };
}

export interface ScrapePipelineDeps {
  appPath: string;
  /** From `RebuildOrchestrationOptions.useAtlasCrawler` resolved against env. */
  useAtlas: boolean;
  /** Reason string for the path-selected log line. */
  scraperReason: 'env-override' | 'jwt-flag' | 'default-legacy';
  /** Original orchestration options — used for the path-selected log only. */
  jwtFlag: boolean;
  envOverride: boolean;
  /** Workflow-state callbacks. The pipeline reads/mutates state but never owns the file. */
  getStatus(appId: string): Promise<RebuildWorkflowState>;
  saveState(state: RebuildWorkflowState): Promise<void>;
  /** Persistence callbacks routed through orchestrator wrappers so existing
   * test spies (`vi.spyOn(service, 'saveSitemap'/'saveMetadata'/'persistScrapedPages')`)
   * continue to intercept. */
  saveSitemap(sitemap: SitemapData): Promise<void>;
  saveMetadata(metadata: SiteMetadata): Promise<void>;
  persistScrapedPages(
    appId: string,
    pages: PageScrapeResult[],
    rootPath: string,
    navigation: NavigationItem[],
  ): Promise<void>;
}

export class ScrapePipeline {
  constructor(private readonly deps: ScrapePipelineDeps) {}

  async run(appId: string, sourceUrl: string): Promise<void> {
    logger.info('rebuild-orchestration.path-selected', {
      appId,
      sourceUrl,
      scraper: this.deps.useAtlas ? 'atlas' : 'legacy-web-scraper',
      reason: this.deps.scraperReason,
      jwtFlag: this.deps.jwtFlag,
      envOverride: this.deps.envOverride,
    });

    if (this.deps.useAtlas) {
      await this.runAtlas(appId, sourceUrl);
    } else {
      await this.runLegacy(appId, sourceUrl);
    }
  }

  private async runLegacy(appId: string, sourceUrl: string): Promise<void> {
    try {
      const state = await this.deps.getStatus(appId);

      let discoveryResult: SitemapDiscoveryResult;
      if (SitemapDiscoveryService.hasPathBeyondRoot(sourceUrl)) {
        logger.info('rebuild-orchestration.sub-path-mode', { appId, sourceUrl, pathPrefix: state.rootPath });
        const sitemapService = new SitemapDiscoveryService(sourceUrl, MAX_PAGES_TO_SCRAPE);
        discoveryResult = await sitemapService.crawlFromPath(state.rootPath);
      } else {
        logger.info('rebuild-orchestration.root-mode', { appId, sourceUrl });
        const sitemapService = new SitemapDiscoveryService(sourceUrl, MAX_PAGES_TO_SCRAPE);
        discoveryResult = await sitemapService.discover();
      }

      if (!discoveryResult.success || discoveryResult.pages.length === 0) {
        throw new Error('Failed to discover pages');
      }

      const nonBlogPages = discoveryResult.pages.filter(p => !p.isBlog);
      const blogPagesCount = discoveryResult.pages.length - nonBlogPages.length;

      // Dedupe by slug before scraping — prevents fetching the same page twice
      // (e.g., cross-domain redirects where foo.com and bar.com/ both → slug "homepage")
      // and eliminates concurrent writes to the same JSON file downstream.
      // Keep last occurrence: discovery prepends the input URL first, canonical comes later.
      const slugMap = new Map<string, typeof nonBlogPages[number]>();
      for (const page of nonBlogPages) {
        slugMap.set(rebuildUrlToSlug(page.url, state.rootPath), page);
      }
      const pagesToScrape = [...slugMap.values()];

      if (pagesToScrape.length < nonBlogPages.length) {
        logger.info('rebuild-orchestration.slug-dedup', {
          appId,
          before: nonBlogPages.length,
          after: pagesToScrape.length,
        });
      }

      logger.info('rebuild-orchestration.pages-discovered', {
        appId,
        totalDiscovered: discoveryResult.pages.length,
        blogPagesExcluded: blogPagesCount,
        pagesToScrape: pagesToScrape.length,
        pages: pagesToScrape.slice(0, 10).map(p => p.url),
      });

      state.scrapingProgress.total = pagesToScrape.length;
      state.status = 'scraping';
      await this.deps.saveState(state);

      const rebuildPipelineStartedAt = Date.now();
      const scraper = new WebsiteScraperDriver();
      const urls = pagesToScrape.map(p => p.url);

      logger.info('rebuild-orchestration.scraping-pages', {
        appId,
        totalUrls: urls.length,
        urls: urls.slice(0, 5),
      });

      const multiPageResult = await scraper.scrapeMultiplePages({
        urls,
        includeAssets: true,
        rateLimit: readRebuildScrapeBatchDelayMs(),
        concurrency: readRebuildScrapeConcurrency(),
      });

      logger.info('rebuild-orchestration.scraping-result', {
        appId,
        totalPages: multiPageResult.totalPages,
        successfulPages: multiPageResult.successfulPages,
        failedPages: multiPageResult.failedPages,
        assetsFound: multiPageResult.assets?.length || 0,
      });

      if (multiPageResult.successfulPages === 0) {
        const firstError = multiPageResult.pages.length > 0 ? multiPageResult.pages[0]?.error : undefined;
        const errorMessage = firstError
          ? `Failed to scrape any pages: ${firstError}`
          : 'Failed to scrape any pages from the source website';
        logger.error('rebuild-orchestration.all-scraping-failed', {
          appId,
          totalAttempted: multiPageResult.totalPages,
          errors: multiPageResult.pages.map(p => ({ url: p.url, error: p.error })),
        });
        throw new Error(errorMessage);
      }

      state.scrapingProgress.completed = multiPageResult.successfulPages;
      state.status = 'analyzing';
      await this.deps.saveState(state);

      const scrapedUrls = new Set(multiPageResult.pages.filter(p => p.success).map(p => p.url));
      const sitemapData: SitemapData = {
        pages: discoveryResult.pages.map(p => ({
          url: p.url,
          slug: rebuildUrlToSlug(p.url, state.rootPath),
          priority: p.priority,
          changefreq: p.changefreq,
          lastmod: p.lastmod,
          source: p.source,
          scraped: scrapedUrls.has(p.url),
          isBlog: p.isBlog,
        })),
        totalPages: discoveryResult.pages.length,
        discoveredAt: new Date().toISOString(),
      };
      await this.deps.saveSitemap(sitemapData);

      logger.info('rebuild-orchestration.saving-pages', {
        appId,
        totalPages: multiPageResult.pages.length,
        pagesWithContent: multiPageResult.pages.filter(p => p.success && p.sanitizedContent).length,
      });
      for (const page of multiPageResult.pages) {
        if (!(page.success && page.sanitizedContent)) {
          logger.warn('rebuild-orchestration.page-skip', {
            appId,
            url: page.url,
            success: page.success,
            hasContent: !!page.sanitizedContent,
            error: page.error,
          });
        }
      }
      await this.deps.persistScrapedPages(appId, multiPageResult.pages, state.rootPath, []);

      const homePage = multiPageResult.pages.find(p => p.success && isRebuildHomepage(p.url, state.rootPath));
      if (!homePage?.sanitizedContent) {
        logger.error('rebuild-orchestration.homepage-analysis-skipped', {
          appId,
          sourceUrl,
          rootPath: state.rootPath,
          successfulUrls: multiPageResult.pages.filter(p => p.success).map(p => p.url),
          homepageCandidates: multiPageResult.pages.map(page => ({
            url: page.url,
            isHomepage: isRebuildHomepage(page.url, state.rootPath),
            success: page.success,
            hasContent: !!page.sanitizedContent,
            error: page.error,
          })),
        });
        throw createRebuildError('Homepage could not be analyzed from scraped pages', {
          code: 'import_failed',
          userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
          isUserFacingError: true,
        });
      }

      const allScrapedAssets = multiPageResult.assets ?? [];
      const { assetMap, homeAssets, otherAssets } = bucketAssetsForProcessing(allScrapedAssets, homePage.url);
      const homeUnique = dedupeExtractedAssetRows(homeAssets);
      const otherUnique = dedupeExtractedAssetRows(otherAssets);

      const analyzer = new SiteAnalyzerAgent();
      await analyzer.initialize();
      const assetService = new AssetProcessingService(this.deps.appPath);

      const analyzerPromise = analyzer
        .analyze(homePage.sanitizedContent, homePage.screenshotBase64)
        .then(async metadata => {
          metadata.sourceUrl = sourceUrl;
          await this.deps.saveMetadata(metadata);
        })
        .finally(async () => {
          await analyzer.cleanup();
        });

      const homeAssetPromise =
        homeUnique.length > 0
          ? assetService
              .process(homeUnique, assetMap, { merge: false })
              .then(async manifest => {
                const preAnalyzeStartedAt = Date.now();
                try {
                  const { pageAssets, analyzedImageCount } = await assetService.analyzePageAssets(
                    homePage.url,
                    manifest,
                  );
                  logger.info('rebuild-orchestration.homepage-assets-pre-analyzed', {
                    appId,
                    pageUrl: homePage.url,
                    pageAssetCount: pageAssets.length,
                    analyzedImageCount,
                    preAnalyzeDurationMs: Date.now() - preAnalyzeStartedAt,
                  });
                } catch (error) {
                  logger.warn('rebuild-orchestration.homepage-assets-pre-analyze-failed', {
                    appId,
                    pageUrl: homePage.url,
                    preAnalyzeDurationMs: Date.now() - preAnalyzeStartedAt,
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              })
          : Promise.resolve(undefined);

      await Promise.all([analyzerPromise, homeAssetPromise]);

      if (otherUnique.length > 0) {
        await assetService.process(otherUnique, assetMap, { merge: true });
      }

      state.status = 'style_questions';
      state.updatedAt = new Date().toISOString();
      await this.deps.saveState(state);

      logger.info('rebuild-orchestration.scrape-complete', {
        appId,
        pagesScraped: multiPageResult.successfulPages,
        assetsFound: allScrapedAssets.length,
        rebuildPipelineDurationMs: Date.now() - rebuildPipelineStartedAt,
      });
    } catch (error) {
      await this.recordError(appId, error, 'rebuild-orchestration.scrape-error');
    }
  }

  async runAtlas(appId: string, sourceUrl: string): Promise<void> {
    try {
      const state = await this.deps.getStatus(appId);
      const rebuildPipelineStartedAt = Date.now();

      logger.info('rebuild-orchestration.atlas-start', { appId, sourceUrl, rootPath: state.rootPath });

      const adapter = new AtlasCrawlerAdapter();
      const crawlOutput = await adapter.crawlSite(sourceUrl, {
        maxPages: MAX_PAGES_TO_SCRAPE,
        rootPath: state.rootPath,
      });

      // Sitemap and page-content lists must agree on rootPath, otherwise the
      // rebuild page selector lists URLs whose JSON content was never written.
      const inRootPath = (url: string): boolean => {
        if (state.rootPath === '/') return true;
        try {
          const pathname = new URL(url).pathname;
          return pathname === state.rootPath || pathname.startsWith(state.rootPath + '/');
        } catch { return false; }
      };

      const nonBlogPages = crawlOutput.sitemapData.pages.filter(p => !p.isBlog && inRootPath(p.url));
      const filteredSitemapData: SitemapData = {
        ...crawlOutput.sitemapData,
        pages: nonBlogPages,
        totalPages: nonBlogPages.length,
      };

      const filteredPages = crawlOutput.pages.filter(p => inRootPath(p.url));
      const successfulPages = filteredPages.filter(p => p.success && (p.sanitizedContent || p.html));

      if (successfulPages.length === 0) {
        throw createRebuildError('Failed to scrape any pages from the source website', {
          code: 'import_failed',
          userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
          isUserFacingError: true,
        });
      }

      state.scrapingProgress.total = successfulPages.length;
      state.scrapingProgress.completed = successfulPages.length;
      state.status = 'analyzing';
      await this.deps.saveState(state);
      await this.deps.saveSitemap(filteredSitemapData);

      logger.info('rebuild-orchestration.atlas-pages-scraped', {
        appId,
        totalPages: successfulPages.length,
        blogPagesExcluded: crawlOutput.sitemapData.pages.length - nonBlogPages.length,
      });

      await this.deps.persistScrapedPages(appId, successfulPages, state.rootPath, crawlOutput.navigation);

      const homePage = successfulPages.find(p => isRebuildHomepage(p.url, state.rootPath));
      if (!homePage || (!homePage.sanitizedContent && !homePage.html)) {
        logger.error('rebuild-orchestration.atlas-homepage-not-found', {
          appId,
          rootPath: state.rootPath,
          successfulUrls: successfulPages.map(p => p.url),
          allPageUrls: crawlOutput.pages.map(p => ({ url: p.url, hasContent: !!p.sanitizedContent, hasHtml: !!p.html })),
        });
        throw createRebuildError('Homepage could not be analyzed from scraped pages', {
          code: 'import_failed',
          userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
          isUserFacingError: true,
        });
      }

      const analyzer = new SiteAnalyzerAgent();
      await analyzer.initialize();

      const screenshotForAnalysis = crawlOutput.homepageScreenshotBase64 || homePage.screenshotBase64;
      if (crawlOutput.atlasReportedScreenshot && !screenshotForAnalysis) {
        // Atlas told us it had a homepage screenshot but the fetch failed (timeout, 4xx,
        // size cap). SiteAnalyzer and PagePromptAgent will run text-only — surface this
        // here so the regression is visible in Loki rather than as silently lower quality.
        // failureReason is propagated from the adapter so a single Loki query splits
        // timeouts from 4xx from cap rejections.
        logger.warn('rebuild-orchestration.atlas-screenshot-missing', {
          appId,
          homepageUrl: homePage.url,
          failureReason: crawlOutput.homepageScreenshotFailureReason,
        });
      }
      const homepageContent = homePage.sanitizedContent || homePage.html || '';

      const aiMetadata = await analyzer.analyze(homepageContent, screenshotForAnalysis);
      await analyzer.cleanup();

      // Merge: atlas design tokens + atlas-extracted contact/footerNav override AI guesses
      const finalMetadata: SiteMetadata = {
        ...aiMetadata,
        sourceUrl,
        siteType: aiMetadata.siteType,
        colorPalette: crawlOutput.designTokenMetadata.colorPalette || aiMetadata.colorPalette,
        typography: crawlOutput.designTokenMetadata.typography || aiMetadata.typography,
        ...(crawlOutput.contact ? { contact: crawlOutput.contact } : {}),
        ...(crawlOutput.footerNavigation.length > 0 ? { footerNavigation: crawlOutput.footerNavigation } : {}),
      };

      await this.deps.saveMetadata(finalMetadata);

      const assetService = new AssetProcessingService(this.deps.appPath);
      const { assetMap, homeAssets, otherAssets } = bucketAssetsForProcessing(crawlOutput.assets, homePage.url);

      if (homeAssets.length > 0) {
        const manifest = await assetService.process(homeAssets, assetMap, { merge: false });
        try {
          await assetService.analyzePageAssets(homePage.url, manifest);
        } catch (error) {
          logger.warn('rebuild-orchestration.atlas-home-assets-analysis-failed', {
            appId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (otherAssets.length > 0) {
        await assetService.process(otherAssets, assetMap, { merge: true });
      }

      state.status = 'style_questions';
      state.updatedAt = new Date().toISOString();
      await this.deps.saveState(state);

      logger.info('rebuild-orchestration.atlas-complete', {
        appId,
        pagesScraped: successfulPages.length,
        assetsFound: crawlOutput.assets.length,
        hasDesignTokens: Object.keys(crawlOutput.designTokenMetadata).length > 0,
        rebuildPipelineDurationMs: Date.now() - rebuildPipelineStartedAt,
      });
    } catch (error) {
      await this.recordError(appId, error, 'rebuild-orchestration.atlas-error');
    }
  }

  private async recordError(appId: string, error: unknown, errorEvent: string): Promise<void> {
    const rebuildError = asRebuildError(error);
    logger.error(errorEvent, {
      appId,
      error: rebuildError.message,
      errorCode: rebuildError.code,
    });

    const state = await this.deps.getStatus(appId);
    state.status = 'error';
    state.error = rebuildError.message;
    state.errorCode = rebuildError.code;
    state.userMessage = rebuildError.userMessage;
    state.updatedAt = new Date().toISOString();
    await this.deps.saveState(state);
  }
}
