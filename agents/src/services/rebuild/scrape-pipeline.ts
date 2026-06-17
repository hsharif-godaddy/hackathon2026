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
import { AtlasCrawlerAdapter, type AtlasCrawlOutput } from '../AtlasCrawlerAdapter.js';
import { SitemapDiscoveryService, type SitemapDiscoveryResult } from '../SitemapDiscoveryService.js';

import { capDiscoveredPages, resolveMaxPagesToScrape } from './scope-estimates.js';

export { MAX_PAGES_TO_SCRAPE } from './scope-estimates.js';

const logger = Logger.create({ component: 'rebuild-orchestration-service' });

/** Statuses where the user has progressed past style-question selection. The
 *  homepage-first callback must never regress these back to 'style_questions'
 *  (e.g. a submitStylePreferences that lands mid-analyze → 'building'). */
const USER_ADVANCED_STATUSES: ReadonlySet<RebuildWorkflowState['status']> = new Set([
  'building',
  'review',
  'complete',
  'error',
]);

/**
 * Return a copy of the sitemap with every non-homepage entry marked
 * `scraped: false`. Used when the inner-page batch fails to persist so the
 * selector doesn't advertise pages whose JSON never made it to disk.
 */
function withInnerPagesUnscraped(sitemap: SitemapData, rootPath: string): SitemapData {
  return {
    ...sitemap,
    pages: sitemap.pages.map(p =>
      isRebuildHomepage(p.url, rootPath) ? p : { ...p, scraped: false },
    ),
  };
}

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
      const maxPages = resolveMaxPagesToScrape(state);
      if (SitemapDiscoveryService.hasPathBeyondRoot(sourceUrl)) {
        logger.info('rebuild-orchestration.sub-path-mode', { appId, sourceUrl, pathPrefix: state.rootPath });
        const sitemapService = new SitemapDiscoveryService(sourceUrl, maxPages);
        discoveryResult = await sitemapService.crawlFromPath(state.rootPath);
      } else {
        logger.info('rebuild-orchestration.root-mode', { appId, sourceUrl });
        const sitemapService = new SitemapDiscoveryService(sourceUrl, maxPages);
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
      const pagesToScrape = capDiscoveredPages([...slugMap.values()], state.rootPath, maxPages);

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
      state.scrapeSettled = true;
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
      let homepageProcessed = false;

      const onHomepageReady = async (homeOutput: AtlasCrawlOutput): Promise<void> => {
        const homePage = homeOutput.pages.find(p => p.success && (p.sanitizedContent || p.html) && isRebuildHomepage(p.url, state.rootPath));
        if (!homePage) {
          logger.warn('rebuild-orchestration.homepage-ready-no-homepage', { appId, pageUrls: homeOutput.pages.map(p => p.url) });
          return;
        }

        state.scrapingProgress.total = homeOutput.sitemapData.totalPages || 1;
        state.scrapingProgress.completed = 1;
        state.status = 'analyzing';
        await this.deps.saveState(state);

        await this.deps.persistScrapedPages(appId, [homePage], state.rootPath, homeOutput.navigation);
        // Defensive: Atlas /home runs phase-1 discovery, so it may return the
        // full sitemap — but only the homepage's JSON is on disk right now.
        // Narrow to the homepage so the selector can't advertise inner pages
        // before they're persisted in the post-crawl pass.
        const homepageOnlyPages = homeOutput.sitemapData.pages.filter(p =>
          isRebuildHomepage(p.url, state.rootPath),
        );
        await this.deps.saveSitemap({
          ...homeOutput.sitemapData,
          pages: homepageOnlyPages,
          totalPages: homepageOnlyPages.length,
        });

        const analyzer = new SiteAnalyzerAgent();
        await analyzer.initialize();
        const screenshotForAnalysis = homeOutput.homepageScreenshotBase64 || homePage.screenshotBase64;
        if (homeOutput.atlasReportedScreenshot && !screenshotForAnalysis) {
          logger.warn('rebuild-orchestration.atlas-screenshot-missing', {
            appId,
            homepageUrl: homePage.url,
            failureReason: homeOutput.homepageScreenshotFailureReason,
          });
        }
        const homepageContent = homePage.sanitizedContent || homePage.html || '';
        const aiMetadata = await analyzer.analyze(homepageContent, screenshotForAnalysis);
        await analyzer.cleanup();

        const finalMetadata = this.mergeSiteMetadata(aiMetadata, sourceUrl, homeOutput);
        await this.deps.saveMetadata(finalMetadata);

        await this.processHomepageAssets(appId, homePage, homeOutput);

        // Re-read state before the final write. `analyze` above is the slow part
        // (~10-15s), and a user submitStylePreferences can land during it, moving
        // status to 'building'. Writing the captured closure `state` here would
        // clobber that transition and drop their preferences. Only advance to
        // 'style_questions' if the user hasn't already moved past it.
        const freshState = await this.deps.getStatus(appId);
        freshState.scrapingProgress.completed = 1;
        if (!USER_ADVANCED_STATUSES.has(freshState.status)) {
          freshState.status = 'style_questions';
        }
        freshState.updatedAt = new Date().toISOString();
        await this.deps.saveState(freshState);

        homepageProcessed = true;
        logger.info('rebuild-orchestration.homepage-ready-processed', {
          appId,
          durationMs: Date.now() - rebuildPipelineStartedAt,
        });
      };

      const crawlOutput = await adapter.crawlSite(sourceUrl, {
        maxPages: resolveMaxPagesToScrape(state),
        rootPath: state.rootPath,
      }, { onHomepageReady });

      // --- Post-crawl: handle full results ---

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

      if (successfulPages.length === 0 && !homepageProcessed) {
        throw createRebuildError('Failed to scrape any pages from the source website', {
          code: 'import_failed',
          userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
          isUserFacingError: true,
        });
      }

      if (!homepageProcessed) {
        // Fallback: homepage_ready never fired — run the full sequential path
        state.scrapingProgress.total = successfulPages.length;
        state.scrapingProgress.completed = successfulPages.length;
        state.updatedAt = new Date().toISOString();
        state.status = 'analyzing';
        await this.deps.saveState(state);

        logger.info('rebuild-orchestration.atlas-pages-scraped', {
          appId,
          totalPages: successfulPages.length,
          blogPagesExcluded: crawlOutput.sitemapData.pages.length - nonBlogPages.length,
        });

        await this.deps.persistScrapedPages(appId, successfulPages, state.rootPath, crawlOutput.navigation);

        // Advertise pages in the sitemap only after their JSON is on disk, so
        // the selector never lists a page whose file doesn't exist yet.
        await this.deps.saveSitemap(filteredSitemapData);

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
          logger.warn('rebuild-orchestration.atlas-screenshot-missing', {
            appId,
            homepageUrl: homePage.url,
            failureReason: crawlOutput.homepageScreenshotFailureReason,
          });
        }
        const homepageContent = homePage.sanitizedContent || homePage.html || '';
        const aiMetadata = await analyzer.analyze(homepageContent, screenshotForAnalysis);
        await analyzer.cleanup();

        const finalMetadata = this.mergeSiteMetadata(aiMetadata, sourceUrl, crawlOutput);
        await this.deps.saveMetadata(finalMetadata);

        await this.processHomepageAssets(appId, homePage, crawlOutput);

        const assetService = new AssetProcessingService(this.deps.appPath);
        // Only otherAssets here (unlike the homepage-already-processed branch
        // which merges the full crawl asset set): processHomepageAssets() above
        // already processed this crawl's home assets non-merge so analyzePageAssets
        // could run on them. Don't add home assets to this merge — already written.
        const { assetMap, otherAssets } = bucketAssetsForProcessing(crawlOutput.assets, homePage.url);
        if (otherAssets.length > 0) {
          await assetService.process(otherAssets, assetMap, { merge: true });
        }

        state.status = 'style_questions';
        state.scrapeSettled = true;
        state.updatedAt = new Date().toISOString();
        await this.deps.saveState(state);
      } else {
        // Homepage already processed — persist inner pages and their assets.
        const innerPages = successfulPages.filter(p => !isRebuildHomepage(p.url, state.rootPath));
        const innerPagesPersisted = await this.tryPersistInnerPages(
          appId, innerPages, state.rootPath, crawlOutput.navigation,
        );

        // Advertise inner pages in the sitemap only after their JSON is on disk.
        // The homepage was already persisted + saved (homepage-only) in the
        // callback; this widens the sitemap to the full page list. If the inner
        // batch failed to persist, don't claim those pages are scraped — the
        // selector would otherwise offer a build that throws on the missing file.
        await this.deps.saveSitemap(
          innerPagesPersisted
            ? filteredSitemapData
            : withInnerPagesUnscraped(filteredSitemapData, state.rootPath),
        );

        const homePage = successfulPages.find(p => isRebuildHomepage(p.url, state.rootPath));
        const assetService = new AssetProcessingService(this.deps.appPath);
        // AIROBUILD-2103: merge the full crawl asset set here, not just
        // otherAssets. The homepage_ready pass only saw the (asset-thin) /home
        // payload, so a homepage-exclusive asset would otherwise never be
        // written. process() dedups by URL, so merging the full set is idempotent.
        const { assetMap } = bucketAssetsForProcessing(crawlOutput.assets, homePage?.url ?? '');
        if (crawlOutput.assets.length > 0) {
          try {
            await assetService.process(crawlOutput.assets, assetMap, { merge: true });
          } catch (error) {
            logger.error('rebuild-orchestration.inner-assets-process-failed', {
              appId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Count only pages actually on disk: the homepage (persisted in the
        // callback) plus the inner batch if it succeeded. A swallowed inner
        // failure must not inflate progress to "all done".
        const completedPages = innerPagesPersisted
          ? successfulPages.length
          : successfulPages.length - innerPages.length;

        // Re-read state immediately before write to pick up any user-side
        // transitions (e.g., submitStylePreferences → 'building') that landed
        // while inner-page work was in flight.
        const freshState = await this.deps.getStatus(appId);
        freshState.scrapingProgress.total = successfulPages.length;
        freshState.scrapingProgress.completed = completedPages;
        freshState.scrapeSettled = true;
        freshState.updatedAt = new Date().toISOString();
        await this.deps.saveState(freshState);
      }

      logger.info('rebuild-orchestration.atlas-complete', {
        appId,
        pagesScraped: successfulPages.length,
        assetsFound: crawlOutput.assets.length,
        homepageProcessedEarly: homepageProcessed,
        hasDesignTokens: Object.keys(crawlOutput.designTokenMetadata).length > 0,
        rebuildPipelineDurationMs: Date.now() - rebuildPipelineStartedAt,
      });
    } catch (error) {
      await this.recordError(appId, error, 'rebuild-orchestration.atlas-error');
    }
  }

  /**
   * Persist the inner-page batch, returning whether it succeeded. Failures are
   * logged and swallowed (the homepage is already built, so the rebuild can
   * proceed) but the boolean lets callers stop claiming the pages are scraped.
   */
  private async tryPersistInnerPages(
    appId: string,
    innerPages: PageScrapeResult[],
    rootPath: string,
    navigation: NavigationItem[],
  ): Promise<boolean> {
    if (innerPages.length === 0) return true;
    try {
      await this.deps.persistScrapedPages(appId, innerPages, rootPath, navigation);
      return true;
    } catch (error) {
      logger.error('rebuild-orchestration.inner-pages-persist-failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private mergeSiteMetadata(aiMetadata: SiteMetadata, sourceUrl: string, output: AtlasCrawlOutput): SiteMetadata {
    return {
      ...aiMetadata,
      sourceUrl,
      colorPalette: output.designTokenMetadata.colorPalette || aiMetadata.colorPalette,
      typography: output.designTokenMetadata.typography || aiMetadata.typography,
      ...(output.contact ? { contact: output.contact } : {}),
      ...(output.footerNavigation.length > 0 ? { footerNavigation: output.footerNavigation } : {}),
      ...(output.favicon ? { favicon: output.favicon } : {}),
    };
  }

  private async processHomepageAssets(appId: string, homePage: PageScrapeResult, output: AtlasCrawlOutput): Promise<void> {
    const assetService = new AssetProcessingService(this.deps.appPath);
    const { assetMap, homeAssets } = bucketAssetsForProcessing(output.assets, homePage.url);
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
