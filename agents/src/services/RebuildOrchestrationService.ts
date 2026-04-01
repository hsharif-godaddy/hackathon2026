import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Logger } from '../logging/index.js';
import {
  asRebuildError,
  createRebuildError,
  type AssetManifest,
  type PageContent,
  type RebuildWorkflowState,
  type SiteMetadata,
  type SourceSiteData,
  type SitemapData,
  type StylePreferences,
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
} from '../types/rebuild.js';
import { AssetProcessingService } from './AssetProcessingService.js';
import { SiteAnalyzerAgent } from '../agents/site-analyzer-agent.js';
import { SitemapDiscoveryService, type SitemapDiscoveryResult } from './SitemapDiscoveryService.js';
import { WebsiteScraperDriver } from '../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import { PagePromptAgent } from '../agents/page-prompt-agent.js';

const logger = Logger.create({ component: 'rebuild-orchestration-service' });

/**
 * Maximum number of pages to discover and scrape from source site
 * Prevents excessive scraping and keeps rebuild scope manageable
 */
const MAX_PAGES_TO_SCRAPE = 20;

/**
 * Rebuild Orchestration Service
 * 
 * Manages the complete workflow for rebuilding a site:
 * 1. Scrape source website
 * 2. Analyze content and design
 * 3. Collect style preferences
 * 4. Generate page build prompts
 */
export class RebuildOrchestrationService {
  private appPath: string;
  private sourceSiteDir: string;
  private stateFilePath: string;

  constructor(appPath: string) {
    this.appPath = appPath;
    this.sourceSiteDir = path.join(appPath, '.source-site');
    this.stateFilePath = path.join(this.sourceSiteDir, 'workflow-state.json');
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

  /**
   * Background task: Scrape and analyze the website
   * 
   * @param appId - Application ID
   * @param sourceUrl - URL to scrape
   */
  private async scrapeAndAnalyze(appId: string, sourceUrl: string): Promise<void> {
    try {
      const state = await this.getStatus(appId);

      let discoveryResult: SitemapDiscoveryResult;

      // Choose discovery method based on whether URL has a path beyond root
      if (SitemapDiscoveryService.hasPathBeyondRoot(sourceUrl)) {
        // Sub-path mode: crawl-based discovery with path prefix filtering
        // Reuse state.rootPath which was already computed in startRebuild()
        logger.info('rebuild-orchestration.sub-path-mode', {
          appId,
          sourceUrl,
          pathPrefix: state.rootPath
        });

        const sitemapService = new SitemapDiscoveryService(sourceUrl, MAX_PAGES_TO_SCRAPE);
        discoveryResult = await sitemapService.crawlFromPath(state.rootPath);
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

      // Filter out blog pages before scraping
      const nonBlogPages = discoveryResult.pages.filter(p => !p.isBlog);
      const blogPagesCount = discoveryResult.pages.length - nonBlogPages.length;

      const pagesToScrape = nonBlogPages;

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

      const scraper = new WebsiteScraperDriver();
      const urls = pagesToScrape.map(p => p.url);

      logger.info('rebuild-orchestration.scraping-pages', {
        appId,
        totalUrls: urls.length,
        urls: urls.slice(0, 5) // Log first 5 URLs
      });

      const multiPageResult = await scraper.scrapeMultiplePages({
        urls,
        includeAssets: true,
        rateLimit: 1000
      });

      logger.info('rebuild-orchestration.scraping-result', {
        appId,
        totalPages: multiPageResult.totalPages,
        successfulPages: multiPageResult.successfulPages,
        failedPages: multiPageResult.failedPages,
        assetsFound: multiPageResult.assets?.length || 0
      });

      // Check if all pages failed to scrape
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

      // Create sitemap with all discovered pages, marking which ones were scraped
      const scrapedUrls = new Set(multiPageResult.pages.filter(p => p.success).map(p => p.url));
      
      const sitemapData: SitemapData = {
        pages: discoveryResult.pages.map(p => ({
          url: p.url,
          slug: this.urlToSlug(p.url, state.rootPath),
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
        if (page.success && page.sanitizedContent) {
          logger.debug('rebuild-orchestration.saving-page', {
            appId,
            url: page.url,
            contentLength: page.sanitizedContent.length,
            htmlLength: page.html?.length || 0,
            hasScreenshot: !!page.screenshotBase64
          });
          await this.savePage({
            url: page.url,
            sanitizedContent: page.sanitizedContent,
            html: page.html,
            screenshotBase64: page.screenshotBase64
          }, state.rootPath);
        } else {
          logger.warn('rebuild-orchestration.page-skip', {
            appId,
            url: page.url,
            success: page.success,
            hasContent: !!page.sanitizedContent,
            error: page.error
          });
        }
      }

      const homePage = multiPageResult.pages.find(p => p.success && this.isHomepage(p.url, state.rootPath));

      if (homePage && homePage.sanitizedContent) {
        const analyzer = new SiteAnalyzerAgent();
        await analyzer.initialize();

        const metadata = await analyzer.analyze(
          homePage.sanitizedContent,
          homePage.screenshotBase64
        );
        metadata.sourceUrl = sourceUrl;

        await this.saveMetadata(metadata);

        await analyzer.cleanup();
      } else {
        logger.error('rebuild-orchestration.homepage-analysis-skipped', {
          appId,
          sourceUrl,
          rootPath: state.rootPath,
          successfulUrls: multiPageResult.pages.filter(p => p.success).map(p => p.url),
          homepageCandidates: multiPageResult.pages.map(page => ({
            url: page.url,
            isHomepage: this.isHomepage(page.url, state.rootPath),
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

      if (multiPageResult.assets && multiPageResult.assets.length > 0) {
        const assetService = new AssetProcessingService(this.appPath);
        const assetMap = new Map<string, string[]>();

        for (const asset of multiPageResult.assets) {
          if (!assetMap.has(asset.url)) {
            assetMap.set(asset.url, []);
          }
          assetMap.get(asset.url)!.push(asset.sourceUrl);
        }

        await assetService.process(multiPageResult.assets, assetMap);
      }

      state.status = 'style_questions';
      state.updatedAt = new Date().toISOString();
      await this.saveState(state);

      logger.info('rebuild-orchestration.scrape-complete', {
        appId,
        pagesScraped: multiPageResult.successfulPages,
        assetsFound: multiPageResult.assets?.length || 0
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
      const analyzedAssets = await assetService.analyzePageAssets(
        pageContent.url,
        sourceSiteData.assets
      );

      logger.info('rebuild-orchestration.page-assets-analyzed', {
        appId,
        pageSlug,
        pageUrl: pageContent.url,
        analyzedCount: analyzedAssets.length
      });

      // Create filtered asset manifest with only assets from this page
      const pageAssetManifest: AssetManifest = {
        assets: analyzedAssets,
        totalAssets: analyzedAssets.length,
        byType: {
          image: analyzedAssets.filter(a => a.type === 'image').length,
          font: analyzedAssets.filter(a => a.type === 'font').length,
          icon: analyzedAssets.filter(a => a.type === 'icon').length,
          other: analyzedAssets.filter(a => a.type === 'other').length
        },
        generatedAt: new Date().toISOString()
      };

      // Create agent with the correct mode (first page vs inner page)
      const promptAgent = new PagePromptAgent({ isFirstPage });
      await promptAgent.initialize();

      const prompt = await promptAgent.generate(
        sourceSiteData.metadata,
        pageContent,
        state.stylePreferences,
        pageAssetManifest,
        isFirstPage
      );

      await promptAgent.cleanup();

      if (!state.pagesBuilt.includes(pageSlug)) {
        state.pagesBuilt.push(pageSlug);
        state.currentPage = pageSlug;
        state.updatedAt = new Date().toISOString();
        await this.saveState(state);
      }

      logger.info('rebuild-orchestration.build-page-complete', {
        appId,
        pageSlug,
        promptLength: prompt.length
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
    page: { url: string; sanitizedContent?: string; html?: string; screenshotBase64?: string },
    rootPath: string = '/'
  ): Promise<void> {
    const slug = this.urlToSlug(page.url, rootPath);

    const pageContent: PageContent = {
      url: page.url,
      slug,
      title: this.extractTitle(page.sanitizedContent || ''),
      content: page.sanitizedContent || '',
      sanitizedContent: page.sanitizedContent || '',
      structure: {
        hasHeader: true,
        hasFooter: true,
        hasSidebar: false,
        sections: [],
        navigation: []
      },
      metadata: {
        title: this.extractTitle(page.sanitizedContent || '')
      },
      scrapedAt: new Date().toISOString()
    };

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

    const pages: Record<string, PageContent> = {};
    for (const sitemapPage of sitemap.pages) {
      if (sitemapPage.scraped) {
        try {
          const pagePath = path.join(this.sourceSiteDir, 'pages', `${sitemapPage.slug}.json`);
          pages[sitemapPage.slug] = JSON.parse(await readFile(pagePath, 'utf-8'));
        } catch {
          continue;
        }
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
      } else if (rootPrefix && pathname !== rootPrefix) {
        // URL doesn't match expected rootPath prefix - log for debugging
        logger.warn('rebuild-orchestration.slug-prefix-mismatch', {
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
}
