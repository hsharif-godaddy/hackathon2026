import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Logger } from '../logging/index.js';
import type { PageScrapeResult } from '../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import {
  type AssetManifest,
  type NavigationItem,
  type RebuildWorkflowState,
  type SiteMetadata,
  type SourceSiteData,
  type SitemapData,
  type StylePreferences,
} from '../types/rebuild.js';
import { rebuildUrlToSlug } from '../utils/rebuild-utils.js';
import { extractNavigationFromHtml, PagePersistenceService, type SavePageInput } from './rebuild/page-persistence.js';
import { RebuildPromptBuilder, type BuildPageResult } from './rebuild/prompt-builder.js';
import { ScrapePipeline } from './rebuild/scrape-pipeline.js';
import { SitemapDiscoveryService } from './SitemapDiscoveryService.js';

const logger = Logger.create({ component: 'rebuild-orchestration-service' });

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
  private cachedScraperPath: {
    useAtlas: boolean;
    reason: 'env-override' | 'jwt-flag' | 'default-legacy';
    jwtFlag: boolean;
    envOverride: boolean;
  } | null = null;
  private persistence: PagePersistenceService;

  constructor(appPath: string, options: RebuildOrchestrationOptions = {}) {
    this.appPath = appPath;
    this.sourceSiteDir = path.join(appPath, '.source-site');
    this.stateFilePath = path.join(this.sourceSiteDir, 'workflow-state.json');
    this.options = options;
    this.persistence = new PagePersistenceService(this.sourceSiteDir);
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
        forms: page.forms,
        metadata: page.metadata,
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
  private resolveScraperPath() {
    if (this.cachedScraperPath) return this.cachedScraperPath;
    const envOverride = process.env.USE_ATLAS_CRAWLER === 'true';
    const jwtFlag = this.options.useAtlasCrawler === true;
    if (envOverride) {
      this.cachedScraperPath = { useAtlas: true, reason: 'env-override', jwtFlag, envOverride };
    } else if (jwtFlag) {
      this.cachedScraperPath = { useAtlas: true, reason: 'jwt-flag', jwtFlag, envOverride };
    } else {
      this.cachedScraperPath = { useAtlas: false, reason: 'default-legacy', jwtFlag, envOverride };
    }
    return this.cachedScraperPath;
  }

  /**
   * Build a freshly-configured ScrapePipeline. Each call captures the current
   * scraper-path resolution + state callbacks so behavior matches the previous
   * inline implementation exactly.
   */
  private buildScrapePipeline(): ScrapePipeline {
    const { useAtlas, reason, jwtFlag, envOverride } = this.resolveScraperPath();
    return new ScrapePipeline({
      appPath: this.appPath,
      useAtlas,
      scraperReason: reason,
      jwtFlag,
      envOverride,
      getStatus: (id) => this.getStatus(id),
      saveState: (s) => this.saveState(s),
      // Persistence callbacks route through this service's wrappers so that
      // existing test spies (`vi.spyOn(service, 'saveSitemap'/...)`) continue
      // to intercept. Moving them to talk directly to PagePersistenceService
      // would require updating the test mocks to spy on `service.persistence`.
      saveSitemap: (s) => this.saveSitemap(s),
      saveMetadata: (m) => this.saveMetadata(m),
      persistScrapedPages: (id, pages, rootPath, navigation) =>
        this.persistScrapedPages(id, pages, rootPath, navigation),
    });
  }

  // Thin delegation — keeps the method on the orchestrator so test mocks
  // that cast and call `(service as never as { scrapeAndAnalyze: ... })` work.
  // Implementation is in ScrapePipeline.run.
  private async scrapeAndAnalyze(appId: string, sourceUrl: string): Promise<void> {
    return this.buildScrapePipeline().run(appId, sourceUrl);
  }

  // Same: thin delegation. Implementation is in ScrapePipeline.runAtlas.
  private async scrapeAndAnalyzeWithAtlas(appId: string, sourceUrl: string): Promise<void> {
    return this.buildScrapePipeline().runAtlas(appId, sourceUrl);
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
    return (await this.buildPageDetailed(appId, pageSlug)).prompt;
  }

  /**
   * Like buildPage, but returns the full BuildPageResult (including source
   * metadata) instead of just the prompt string. Used by callers that need
   * sourceUrl / pageTitle / imageCount for confirmation UI.
   *
   * Emits the lifecycle marker before any I/O so the operator sees a
   * build-page event even when the subsequent state load fails.
   */
  async buildPageDetailed(appId: string, pageSlug: string): Promise<BuildPageResult> {
    try {
      logger.info('rebuild-orchestration.build-page', { appId, pageSlug });
      const state = await this.getStatus(appId);
      const builder = new RebuildPromptBuilder(
        this.appPath,
        this.sourceSiteDir,
        this.persistence,
        this.resolveScraperPath().useAtlas,
      );
      const result = await builder.buildPage(appId, pageSlug, state);

      if (!state.pagesBuilt.includes(pageSlug)) {
        state.pagesBuilt.push(pageSlug);
        state.currentPage = pageSlug;
        state.updatedAt = new Date().toISOString();
        await this.saveState(state);
      }

      logger.info('rebuild-orchestration.build-page-complete', {
        appId,
        pageSlug,
        promptLength: result.prompt.length,
        ...(result.specPath
          ? { specPath: result.specPath, specPatternCount: result.specPatternCount, specFormCount: result.specFormCount }
          : {}),
      });

      return result;
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
  // Persistence delegations — actual I/O lives in PagePersistenceService.
  // Kept as private methods on the orchestrator so existing tests' `vi.spyOn`
  // calls continue to work; remove once tests migrate to spy on `this.persistence`.
  private async saveMetadata(metadata: SiteMetadata): Promise<void> {
    return this.persistence.saveMetadata(metadata);
  }

  private async saveSitemap(sitemap: SitemapData): Promise<void> {
    return this.persistence.saveSitemap(sitemap);
  }

  /**
   * Save page content to disk
   *
   * @param page - Page scrape result
   */
  private async savePage(
    page: SavePageInput,
    rootPath: string = '/',
    navigation: NavigationItem[] = []
  ): Promise<void> {
    const slug = rebuildUrlToSlug(page.url, rootPath);
    const effectiveNavigation = navigation.length > 0
      ? navigation
      : extractNavigationFromHtml(page.html, page.url);
    const useAtlas = this.resolveScraperPath().useAtlas;
    return this.persistence.savePage(page, slug, effectiveNavigation, useAtlas);
  }

  /**
   * Load complete source site data
   * 
   * @returns Promise resolving to source site data
   */
  private async loadSourceSiteData(): Promise<SourceSiteData> {
    return this.persistence.loadSourceSiteData();
  }

  async getAssetManifest(): Promise<AssetManifest | null> {
    return this.persistence.getAssetManifest();
  }
}
