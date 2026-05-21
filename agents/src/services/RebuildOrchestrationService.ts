import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { PagePromptAgent } from '../agents/page-prompt-agent.js';
import { SiteAnalyzerAgent } from '../agents/site-analyzer-agent.js';
import { Logger } from '../logging/index.js';
import {
  asRebuildError,
  createRebuildError,
  type AssetManifest,
  type FormHint,
  type NavigationItem,
  type PageBuildSpec,
  type PageContent,
  type SpecAssetManifest,
  type RebuildWorkflowState,
  type SiteMetadata,
  type SourceSiteData,
  type SitemapData,
  type StylePreferences,
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
} from '../types/rebuild.js';
import type { PageScrapeResult } from '../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import { WebsiteScraperDriver } from '../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import { normalizeAssetPath } from '../utils/asset-paths.js';
import { resizeForVision } from '../utils/image-resize.js';
import { isRebuildHomepage, normalizeRebuildPageKey, rebuildUrlToSlug } from '../utils/rebuild-utils.js';
import { AssetProcessingService } from './AssetProcessingService.js';
import { AtlasCrawlerAdapter } from './AtlasCrawlerAdapter.js';
import { detectInteractivePatterns } from './interactive-pattern-detector.js';
import { SitemapDiscoveryService, type SitemapDiscoveryResult } from './SitemapDiscoveryService.js';

const logger = Logger.create({ component: 'rebuild-orchestration-service' });

/**
 * Maximum number of pages to discover and scrape from source site
 * Prevents excessive scraping and keeps rebuild scope manageable
 */
const MAX_PAGES_TO_SCRAPE = 20;

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
 * Rebuild Orchestration Service
 * 
 * Manages the complete workflow for rebuilding a site:
 * 1. Scrape source website
 * 2. Analyze content and design
 * 3. Collect style preferences
 * 4. Generate page build prompts
 */
export interface RebuildOrchestrationOptions {
  useAtlasCrawler?: boolean;
}

export class RebuildOrchestrationService {
  private appPath: string;
  private sourceSiteDir: string;
  private stateFilePath: string;
  private options: RebuildOrchestrationOptions;
  private cachedScraperPath: { useAtlas: boolean; reason: 'env-override' | 'jwt-flag' | 'default-legacy' } | null = null;

  constructor(appPath: string, options: RebuildOrchestrationOptions = {}) {
    this.appPath = appPath;
    this.sourceSiteDir = path.join(appPath, '.source-site');
    this.stateFilePath = path.join(this.sourceSiteDir, 'workflow-state.json');
    this.options = options;
  }

  /**
   * Start the rebuild workflow
   * 
   * @param appId - Application ID
   * @param sourceUrl - URL of site to rebuild
   * @returns Promise resolving to initial workflow state
   */
  async startRebuild(appId: string, sourceUrl: string): Promise<RebuildWorkflowState> {
    try {
      logger.info('rebuild-orchestration.start', {
        appId,
        sourceUrl
      });

      await mkdir(this.sourceSiteDir, { recursive: true });
      await mkdir(path.join(this.sourceSiteDir, 'pages'), { recursive: true });
      await mkdir(path.join(this.sourceSiteDir, 'screenshots'), { recursive: true });

      const state: RebuildWorkflowState = {
        appId,
        sourceUrl,
        rootPath: SitemapDiscoveryService.extractPathPrefix(sourceUrl),
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

  private async persistOneScrapedPage(
    appId: string,
    page: PageScrapeResult,
    rootPath: string,
    navigation: NavigationItem[] = []
  ): Promise<void> {
    const sanitized = page.sanitizedContent;
    if (!sanitized) {
      return;
    }
    logger.debug('rebuild-orchestration.saving-page', {
      appId,
      url: page.url,
      contentLength: sanitized.length,
      htmlLength: page.html?.length ?? 0,
      hasScreenshot: !!page.screenshotBase64
    });
    await this.savePage(
      {
        url: page.url,
        sanitizedContent: sanitized,
        html: page.html,
        screenshotBase64: page.screenshotBase64,
        forms: page.forms
      },
      rootPath,
      navigation
    );
  }

  private async persistScrapedPages(
    appId: string,
    pages: PageScrapeResult[],
    rootPath: string,
    navigation: NavigationItem[] = []
  ): Promise<void> {
    const withContent = pages.filter(p => p.success && p.sanitizedContent);
    if (withContent.length === 0) {
      return;
    }

    // Dedupe by slug — prevents concurrent writes to the same file when
    // multiple URLs resolve to the same slug (e.g., cross-domain redirects)
    const slugMap = new Map<string, PageScrapeResult>();
    for (const page of withContent) {
      slugMap.set(rebuildUrlToSlug(page.url, rootPath), page);
    }
    const toPersist = [...slugMap.values()];

    await Promise.all(
      toPersist.map(page => this.persistOneScrapedPage(appId, page, rootPath, navigation))
    );
  }

  /**
   * Background task: Scrape and analyze the website
   *
   * @param appId - Application ID
   * @param sourceUrl - URL to scrape
   */
  private resolveScraperPath(): { useAtlas: boolean; reason: 'env-override' | 'jwt-flag' | 'default-legacy' } {
    if (this.cachedScraperPath) return this.cachedScraperPath;
    if (process.env.USE_ATLAS_CRAWLER === 'true') {
      this.cachedScraperPath = { useAtlas: true, reason: 'env-override' };
    } else if (this.options.useAtlasCrawler === true) {
      this.cachedScraperPath = { useAtlas: true, reason: 'jwt-flag' };
    } else {
      this.cachedScraperPath = { useAtlas: false, reason: 'default-legacy' };
    }
    return this.cachedScraperPath;
  }

  private async scrapeAndAnalyze(appId: string, sourceUrl: string): Promise<void> {
    const { useAtlas, reason } = this.resolveScraperPath();
    logger.info('rebuild-orchestration.path-selected', {
      appId,
      sourceUrl,
      scraper: useAtlas ? 'atlas' : 'legacy-web-scraper',
      reason,
      jwtFlag: this.options.useAtlasCrawler === true,
      envOverride: process.env.USE_ATLAS_CRAWLER === 'true',
    });

    if (useAtlas) {
      await this.scrapeAndAnalyzeWithAtlas(appId, sourceUrl);
      return;
    }

    try {
      const state = await this.getStatus(appId);

      let discoveryResult: SitemapDiscoveryResult;

      if (SitemapDiscoveryService.hasPathBeyondRoot(sourceUrl)) {
        logger.info('rebuild-orchestration.sub-path-mode', {
          appId,
          sourceUrl,
          pathPrefix: state.rootPath
        });

        const sitemapService = new SitemapDiscoveryService(sourceUrl, MAX_PAGES_TO_SCRAPE);
        discoveryResult = await sitemapService.crawlFromPath(state.rootPath);
      } else {
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
          after: pagesToScrape.length
        });
      }

      logger.info('rebuild-orchestration.pages-discovered', {
        appId,
        totalDiscovered: discoveryResult.pages.length,
        blogPagesExcluded: blogPagesCount,
        pagesToScrape: pagesToScrape.length,
        pages: pagesToScrape.slice(0, 10).map(p => p.url)
      });

      state.scrapingProgress.total = pagesToScrape.length;
      state.status = 'scraping';
      await this.saveState(state);

      const rebuildPipelineStartedAt = Date.now();
      const scraper = new WebsiteScraperDriver();
      const urls = pagesToScrape.map(p => p.url);

      logger.info('rebuild-orchestration.scraping-pages', {
        appId,
        totalUrls: urls.length,
        urls: urls.slice(0, 5)
      });

      const multiPageResult = await scraper.scrapeMultiplePages({
        urls,
        includeAssets: true,
        rateLimit: readRebuildScrapeBatchDelayMs(),
        concurrency: readRebuildScrapeConcurrency()
      });

      logger.info('rebuild-orchestration.scraping-result', {
        appId,
        totalPages: multiPageResult.totalPages,
        successfulPages: multiPageResult.successfulPages,
        failedPages: multiPageResult.failedPages,
        assetsFound: multiPageResult.assets?.length || 0
      });

      if (multiPageResult.successfulPages === 0) {
        const firstError = multiPageResult.pages.length > 0 ? multiPageResult.pages[0]?.error : undefined;
        const errorMessage = firstError
          ? `Failed to scrape any pages: ${firstError}`
          : 'Failed to scrape any pages from the source website';

        logger.error('rebuild-orchestration.all-scraping-failed', {
          appId,
          totalAttempted: multiPageResult.totalPages,
          errors: multiPageResult.pages.map(p => ({ url: p.url, error: p.error }))
        });

        throw new Error(errorMessage);
      }

      state.scrapingProgress.completed = multiPageResult.successfulPages;
      state.status = 'analyzing';
      await this.saveState(state);

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
          isBlog: p.isBlog
        })),
        totalPages: discoveryResult.pages.length,
        discoveredAt: new Date().toISOString()
      };

      await this.saveSitemap(sitemapData);

      logger.info('rebuild-orchestration.saving-pages', {
        appId,
        totalPages: multiPageResult.pages.length,
        pagesWithContent: multiPageResult.pages.filter(p => p.success && p.sanitizedContent).length
      });

      for (const page of multiPageResult.pages) {
        if (!(page.success && page.sanitizedContent)) {
          logger.warn('rebuild-orchestration.page-skip', {
            appId,
            url: page.url,
            success: page.success,
            hasContent: !!page.sanitizedContent,
            error: page.error
          });
        }
      }

      await this.persistScrapedPages(appId, multiPageResult.pages, state.rootPath);

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
            error: page.error
          }))
        });
        throw createRebuildError('Homepage could not be analyzed from scraped pages', {
          code: 'import_failed',
          userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
          isUserFacingError: true
        });
      }

      const allScrapedAssets = multiPageResult.assets ?? [];
      const assetMap = new Map<string, string[]>();
      for (const asset of allScrapedAssets) {
        if (!assetMap.has(asset.url)) {
          assetMap.set(asset.url, []);
        }
        assetMap.get(asset.url)!.push(asset.sourceUrl);
      }

      const homeKey = normalizeRebuildPageKey(homePage.url);
      const homeAssetRows = allScrapedAssets.filter(
        a => normalizeRebuildPageKey(a.sourceUrl) === homeKey
      );
      const otherAssetRows = allScrapedAssets.filter(
        a => normalizeRebuildPageKey(a.sourceUrl) !== homeKey
      );
      const homeUnique = dedupeExtractedAssetRows(homeAssetRows);
      const otherUnique = dedupeExtractedAssetRows(otherAssetRows);

      const analyzer = new SiteAnalyzerAgent();
      await analyzer.initialize();

      const assetService = new AssetProcessingService(this.appPath);

      const analyzerPromise = analyzer
        .analyze(homePage.sanitizedContent, homePage.screenshotBase64)
        .then(async metadata => {
          metadata.sourceUrl = sourceUrl;
          await this.saveMetadata(metadata);
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
                    manifest
                  );
                  logger.info('rebuild-orchestration.homepage-assets-pre-analyzed', {
                    appId,
                    pageUrl: homePage.url,
                    pageAssetCount: pageAssets.length,
                    analyzedImageCount,
                    preAnalyzeDurationMs: Date.now() - preAnalyzeStartedAt
                  });
                } catch (error) {
                  logger.warn('rebuild-orchestration.homepage-assets-pre-analyze-failed', {
                    appId,
                    pageUrl: homePage.url,
                    preAnalyzeDurationMs: Date.now() - preAnalyzeStartedAt,
                    error: error instanceof Error ? error.message : String(error)
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
      await this.saveState(state);

      logger.info('rebuild-orchestration.scrape-complete', {
        appId,
        pagesScraped: multiPageResult.successfulPages,
        assetsFound: allScrapedAssets.length,
        rebuildPipelineDurationMs: Date.now() - rebuildPipelineStartedAt
      });
    } catch (error) {
      const rebuildError = asRebuildError(error);

      logger.error('rebuild-orchestration.scrape-error', {
        appId,
        error: rebuildError.message,
        errorCode: rebuildError.code
      });

      const state = await this.getStatus(appId);
      state.status = 'error';
      state.error = rebuildError.message;
      state.errorCode = rebuildError.code;
      state.userMessage = rebuildError.userMessage;
      state.updatedAt = new Date().toISOString();
      await this.saveState(state);
    }
  }

  /**
   * Atlas-based scrape and analyze pipeline.
   * Uses local Puppeteer crawler instead of external web-scraper API.
   */
  private async scrapeAndAnalyzeWithAtlas(appId: string, sourceUrl: string): Promise<void> {
    try {
      const state = await this.getStatus(appId);
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
      await this.saveState(state);
      await this.saveSitemap(filteredSitemapData);

      logger.info('rebuild-orchestration.atlas-pages-scraped', {
        appId,
        totalPages: successfulPages.length,
        blogPagesExcluded: crawlOutput.sitemapData.pages.length - nonBlogPages.length,
      });

      await this.persistScrapedPages(appId, successfulPages, state.rootPath, crawlOutput.navigation);

      // Find homepage
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

      // Run SiteAnalyzerAgent for siteType classification
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

      await this.saveMetadata(finalMetadata);

      // Process assets
      const assetService = new AssetProcessingService(this.appPath);
      const assetMap = new Map<string, string[]>();
      for (const asset of crawlOutput.assets) {
        if (!assetMap.has(asset.url)) {
          assetMap.set(asset.url, []);
        }
        assetMap.get(asset.url)!.push(asset.sourceUrl);
      }

      const homeKey = normalizeRebuildPageKey(homePage.url);
      const homeAssets = crawlOutput.assets.filter(a => normalizeRebuildPageKey(a.sourceUrl) === homeKey);
      const otherAssets = crawlOutput.assets.filter(a => normalizeRebuildPageKey(a.sourceUrl) !== homeKey);

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
      await this.saveState(state);

      logger.info('rebuild-orchestration.atlas-complete', {
        appId,
        pagesScraped: successfulPages.length,
        assetsFound: crawlOutput.assets.length,
        hasDesignTokens: Object.keys(crawlOutput.designTokenMetadata).length > 0,
        rebuildPipelineDurationMs: Date.now() - rebuildPipelineStartedAt,
      });
    } catch (error) {
      const rebuildError = asRebuildError(error);

      logger.error('rebuild-orchestration.atlas-error', {
        appId,
        error: rebuildError.message,
        errorCode: rebuildError.code,
      });

      const state = await this.getStatus(appId);
      state.status = 'error';
      state.error = rebuildError.message;
      state.errorCode = rebuildError.code;
      state.userMessage = rebuildError.userMessage;
      state.updatedAt = new Date().toISOString();
      await this.saveState(state);
    }
  }

  /**
   * Submit style preferences
   *
   * @param appId - Application ID
   * @param preferences - User's style preferences
   * @returns Promise resolving to updated state
   */
  async submitStylePreferences(appId: string, preferences: StylePreferences): Promise<RebuildWorkflowState> {
    try {
      const state = await this.getStatus(appId);

      state.stylePreferences = preferences;
      state.status = 'building';
      state.updatedAt = new Date().toISOString();

      await this.saveState(state);

      logger.info('rebuild-orchestration.preferences-saved', {
        appId,
        preferences
      });

      return state;
    } catch (error) {
      logger.error('rebuild-orchestration.preferences-error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Build a specific page
   * 
   * @param appId - Application ID
   * @param pageSlug - Slug of page to build
   * @returns Promise resolving to generated prompt
   */
  async buildPage(appId: string, pageSlug: string): Promise<string> {
    try {
      logger.info('rebuild-orchestration.build-page', {
        appId,
        pageSlug
      });

      const sourceSiteData = await this.loadSourceSiteData();

      const state = await this.getStatus(appId);

      if (!state.stylePreferences) {
        throw new Error('Style preferences not set');
      }

      const pageContent = sourceSiteData.pages[pageSlug];
      if (!pageContent) {
        throw new Error(`Page not found: ${pageSlug}`);
      }

      // First page (homepage) gets full setup instructions
      // Subsequent pages skip project setup, colors, fonts, header/footer
      const isFirstPage = state.pagesBuilt.length === 0;

      logger.info('rebuild-orchestration.generating-prompt', {
        appId,
        pageSlug,
        isFirstPage,
        pagesBuiltCount: state.pagesBuilt.length
      });

      // Lazy analysis: Analyze assets used on this page before generating prompt
      logger.info('rebuild-orchestration.analyzing-page-assets', {
        appId,
        pageSlug,
        pageUrl: pageContent.url
      });

      const assetService = new AssetProcessingService(this.appPath);
      const { pageAssets, analyzedImageCount } = await assetService.analyzePageAssets(
        pageContent.url,
        sourceSiteData.assets
      );

      logger.info('rebuild-orchestration.page-assets-analyzed', {
        appId,
        pageSlug,
        pageUrl: pageContent.url,
        pageAssetCount: pageAssets.length,
        analyzedImageCount
      });

      const pageAssetManifest: AssetManifest = {
        assets: pageAssets,
        totalAssets: pageAssets.length,
        byType: {
          image: pageAssets.filter(a => a.type === 'image').length,
          font: pageAssets.filter(a => a.type === 'font').length,
          icon: pageAssets.filter(a => a.type === 'icon').length,
          other: pageAssets.filter(a => a.type === 'other').length
        },
        generatedAt: new Date().toISOString()
      };

      // Load homepage screenshot for visual reference (first page only)
      let screenshotBase64: string | undefined;
      if (isFirstPage) {
        const screenshotPath = path.join(this.sourceSiteDir, 'screenshots', 'homepage.png');
        try {
          const raw = await readFile(screenshotPath);
          const { buffer: resized, mimeType } = await resizeForVision(raw, 'image/png');
          screenshotBase64 = `data:${mimeType};base64,${resized.toString('base64')}`;
        } catch {
          logger.info('rebuild-orchestration.homepage-screenshot-not-found', { appId, pageSlug });
        }
      }

      // Create agent with the correct mode (first page vs inner page)
      const promptAgent = new PagePromptAgent({ isFirstPage, useAtlasCrawler: this.resolveScraperPath().useAtlas });
      await promptAgent.initialize();

      const prompt = await promptAgent.generate(
        sourceSiteData.metadata,
        pageContent,
        state.stylePreferences,
        pageAssetManifest,
        isFirstPage,
        screenshotBase64
      );

      await promptAgent.cleanup();

      // Structured handoff seam: emit a code-built spec for develop-agent
      // consumption. Atlas-only — legacy scraper doesn't produce the form/pattern
      // signals the spec promises, so we'd be shipping a half-empty handoff.
      // Write the spec BEFORE recording the page as built; if writeFile throws,
      // a retry treats this as the homepage (isFirstPage check) instead of a
      // half-built inner page.
      let specPath: string | undefined;
      let specPatternCount = 0;
      let specFormCount = 0;
      if (this.resolveScraperPath().useAtlas) {
        const spec = this.buildPageSpec(pageSlug, pageContent, sourceSiteData.metadata, state.stylePreferences, pageAssetManifest, isFirstPage);
        specPath = path.join(this.sourceSiteDir, `${pageSlug}-spec.json`);
        await writeFile(specPath, JSON.stringify(spec, null, 2), 'utf-8');
        specPatternCount = spec.detectedPatterns.length;
        specFormCount = spec.forms.length;
      }

      if (!state.pagesBuilt.includes(pageSlug)) {
        state.pagesBuilt.push(pageSlug);
        state.currentPage = pageSlug;
        state.updatedAt = new Date().toISOString();
        await this.saveState(state);
      }

      logger.info('rebuild-orchestration.build-page-complete', {
        appId,
        pageSlug,
        promptLength: prompt.length,
        ...(specPath ? { specPath, specPatternCount, specFormCount } : {})
      });

      return prompt;
    } catch (error) {
      logger.error('rebuild-orchestration.build-page-error', {
        appId,
        pageSlug,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Build the structured handoff spec from the same inputs PagePromptAgent uses.
   * Code-built only — no LLM judgment. Develop agent consumes this for facts
   * (asset paths, form schemas, detected patterns, navigation) so they don't
   * round-trip through markdown reinterpretation.
   *
   * Asset paths are normalized to public paths (/assets/...) so spec consumers
   * can use them directly without re-deriving from on-disk locations.
   */
  private buildPageSpec(
    pageSlug: string,
    pageContent: PageContent,
    siteMetadata: SiteMetadata,
    stylePreferences: StylePreferences,
    pageAssetManifest: AssetManifest,
    isFirstPage: boolean
  ): PageBuildSpec {
    const normalizedAssets: SpecAssetManifest = {
      ...pageAssetManifest,
      assets: pageAssetManifest.assets.map(({ localPath, ...rest }) => ({
        ...rest,
        publicPath: normalizeAssetPath(localPath)
      }))
    };

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      page: {
        url: pageContent.url,
        slug: pageSlug,
        title: pageContent.title,
        isFirstPage
      },
      site: {
        sourceUrl: siteMetadata.sourceUrl,
        siteType: siteMetadata.siteType ?? 'content',
        sitePurpose: siteMetadata.sitePurpose,
        targetAudience: siteMetadata.targetAudience,
        brandVoice: siteMetadata.brandVoice,
        designStyle: siteMetadata.designStyle,
        colorPalette: siteMetadata.colorPalette,
        typography: siteMetadata.typography,
        ...(siteMetadata.contact ? { contact: siteMetadata.contact } : {})
      },
      navigation: {
        primary: pageContent.structure.navigation,
        footer: siteMetadata.footerNavigation ?? []
      },
      detectedPatterns: pageContent.structure.interactivePatterns ?? [],
      forms: pageContent.structure.forms ?? [],
      assets: normalizedAssets,
      stylePreferences,
      pageContent: {
        sanitizedContent: pageContent.sanitizedContent
      }
    };
  }

  /**
   * Get current workflow status
   *
   * @param appId - Application ID
   * @returns Promise resolving to current state
   */
  async getStatus(appId: string): Promise<RebuildWorkflowState> {
    try {
      const stateJson = await readFile(this.stateFilePath, 'utf-8');
      return JSON.parse(stateJson);
    } catch (error) {
      throw new Error('Workflow state not found');
    }
  }

  /**
   * Get list of available pages to build
   * 
   * @returns Promise resolving to array of page slugs and titles
   */
  async getAvailablePages(): Promise<Array<{ slug: string; title: string; url: string }>> {
    try {
      // Try to load sitemap first (which is created earlier in the process)
      const sitemapPath = path.join(this.sourceSiteDir, 'sitemap.json');
      
      try {
        const sitemap: SitemapData = JSON.parse(await readFile(sitemapPath, 'utf-8'));
        
        // Return pages from sitemap
        return sitemap.pages
          .filter(p => p.scraped)
          .map(p => ({
            slug: p.slug,
            title: p.url, // We'll use URL as title until we load the actual page
            url: p.url
          }));
      } catch (sitemapError) {
        logger.warn('rebuild-orchestration.sitemap-not-found', {
          message: 'Sitemap not yet created, trying full source site data'
        });
      }

      // Fallback to loading complete source site data
      const sourceSiteData = await this.loadSourceSiteData();

      return Object.entries(sourceSiteData.pages).map(([slug, page]) => ({
        slug,
        title: page.title,
        url: page.url
      }));
    } catch (error) {
      logger.error('rebuild-orchestration.get-pages-error', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Save workflow state to disk
   * 
   * @param state - Workflow state
   */
  private async saveState(state: RebuildWorkflowState): Promise<void> {
    await writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Save site metadata to disk
   * 
   * @param metadata - Site metadata
   */
  private async saveMetadata(metadata: SiteMetadata): Promise<void> {
    const metadataPath = path.join(this.sourceSiteDir, 'site-metadata.json');
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  /**
   * Save sitemap to disk
   * 
   * @param sitemap - Sitemap data
   */
  private async saveSitemap(sitemap: SitemapData): Promise<void> {
    const sitemapPath = path.join(this.sourceSiteDir, 'sitemap.json');
    await writeFile(sitemapPath, JSON.stringify(sitemap, null, 2), 'utf-8');
  }

  /**
   * Save page content to disk
   *
   * @param page - Page scrape result
   */
  private async savePage(
    page: { url: string; sanitizedContent?: string; html?: string; screenshotBase64?: string; forms?: FormHint[] },
    rootPath: string = '/',
    navigation: NavigationItem[] = []
  ): Promise<void> {
    const slug = rebuildUrlToSlug(page.url, rootPath);

    const effectiveNavigation = navigation.length > 0
      ? navigation
      : this.extractNavigationFromHtml(page.html, page.url);

    const title = this.extractTitle(page.sanitizedContent || '');
    // Pattern detection + form attachment are Atlas-path enrichments. Legacy
    // scraper doesn't produce structured forms; running the detector on its
    // HTML is harmless but its outputs feed Atlas-gated downstream behavior.
    const useAtlas = this.resolveScraperPath().useAtlas;
    if (useAtlas && !page.html) {
      logger.warn('rebuild-orchestration.atlas-missing-html', {
        url: page.url,
        slug,
        message: 'Atlas page returned without raw HTML; pattern detection will be skipped'
      });
    }
    const interactivePatterns = useAtlas ? detectInteractivePatterns(page.html) : [];
    const forms = useAtlas ? (page.forms ?? []) : [];

    const pageContent: PageContent = {
      url: page.url,
      slug,
      title,
      content: page.sanitizedContent || '',
      sanitizedContent: page.sanitizedContent || '',
      structure: {
        hasHeader: true,
        hasFooter: true,
        hasSidebar: false,
        sections: [],
        navigation: effectiveNavigation,
        ...(interactivePatterns.length > 0 ? { interactivePatterns } : {}),
        ...(forms.length > 0 ? { forms } : {})
      },
      metadata: { title },
      scrapedAt: new Date().toISOString()
    };

    if (interactivePatterns.length > 0) {
      logger.debug('rebuild-orchestration.interactive-patterns-detected', {
        url: page.url,
        slug,
        patterns: interactivePatterns.map(p => `${p.type}(${p.occurrences})`)
      });
    }

    if (forms.length > 0) {
      logger.debug('rebuild-orchestration.forms-detected', {
        url: page.url,
        slug,
        formCount: forms.length,
        summary: forms.map(f => `${f.method.toUpperCase()}->${f.action ?? '(no action)'} (${f.fields.length} fields)`)
      });
    }

    const pagePath = path.join(this.sourceSiteDir, 'pages', `${slug}.json`);
    await writeFile(pagePath, JSON.stringify(pageContent, null, 2), 'utf-8');

    // Save raw HTML for debugging and analysis
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

  /**
   * Load complete source site data
   * 
   * @returns Promise resolving to source site data
   */
  private async loadSourceSiteData(): Promise<SourceSiteData> {
    const metadataPath = path.join(this.sourceSiteDir, 'site-metadata.json');
    const sitemapPath = path.join(this.sourceSiteDir, 'sitemap.json');
    const assetManifestPath = path.join(this.sourceSiteDir, 'assets', 'manifest.json');

    const metadata: SiteMetadata = JSON.parse(await readFile(metadataPath, 'utf-8'));
    const sitemap: SitemapData = JSON.parse(await readFile(sitemapPath, 'utf-8'));

    let assets: AssetManifest = {
      assets: [],
      totalAssets: 0,
      byType: { image: 0, font: 0, icon: 0, other: 0 },
      generatedAt: new Date().toISOString()
    };

    try {
      assets = JSON.parse(await readFile(assetManifestPath, 'utf-8'));
    } catch {
      logger.warn('rebuild-orchestration.no-assets', {
        message: 'Asset manifest not found'
      });
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
      })
    );

    const pages: Record<string, PageContent> = {};
    for (const entry of loaded) {
      if (entry) {
        pages[entry[0]] = entry[1];
      }
    }

    return {
      metadata,
      sitemap,
      pages,
      assets
    };
  }

  /**
   * Get asset manifest
   *
   * @returns Promise resolving to asset manifest or null if not found
   */
  async getAssetManifest(): Promise<AssetManifest | null> {
    const assetManifestPath = path.join(this.sourceSiteDir, 'assets', 'manifest.json');

    try {
      return JSON.parse(await readFile(assetManifestPath, 'utf-8'));
    } catch {
      return null;
    }
  }


  /**
   * Extract title from content
   * 
   * @param content - Page content
   * @returns Extracted title
   */
  private extractTitle(content: string): string {
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

  private extractNavigationFromHtml(html: string | undefined, pageUrl: string): NavigationItem[] {
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
}
