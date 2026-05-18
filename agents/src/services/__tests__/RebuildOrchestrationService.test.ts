import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SiteAnalyzerAgent } from '../../agents/site-analyzer-agent.js';
import { WebsiteScraperDriver } from '../../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import {
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
} from '../../types/rebuild.js';
import { AssetProcessingService } from '../AssetProcessingService.js';
import { AtlasCrawlerAdapter } from '../AtlasCrawlerAdapter.js';
import { RebuildOrchestrationService } from '../RebuildOrchestrationService.js';
import { SitemapDiscoveryService } from '../SitemapDiscoveryService.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => mockLogger,
  },
}));

describe('RebuildOrchestrationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.debug.mockReset();
  });

  it('should mark workflow as import_failed when no scraped page matches homepage', async () => {
    const service = new RebuildOrchestrationService('/tmp/test-app');
    const state = {
      appId: 'app-123',
      sourceUrl: 'https://example.com',
      rootPath: '/',
      status: 'scraping' as const,
      scrapingProgress: {
        total: 0,
        completed: 0
      },
      pagesBuilt: [],
      currentPage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    vi.spyOn(SitemapDiscoveryService.prototype, 'discover').mockResolvedValue({
      success: true,
      pages: [
        {
          url: 'https://example.com/index.htm',
          priority: 1,
          source: 'crawl'
        }
      ],
      totalPages: 1
    });
    vi.spyOn(WebsiteScraperDriver.prototype, 'scrapeMultiplePages').mockResolvedValue({
      success: true,
      totalPages: 1,
      successfulPages: 1,
      failedPages: 0,
      pages: [
        {
          url: 'https://example.com/index.htm',
          success: true,
          sanitizedContent: '<html><title>Home</title></html>',
          html: '<html><title>Home</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        }
      ],
      assets: []
    } as never);

    const getStatus = vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
    const saveState = vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
    vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
    vi.spyOn(service as never, 'savePage').mockResolvedValue(undefined);
    const saveMetadata = vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

    await (service as any).scrapeAndAnalyze('app-123', 'https://example.com');

    expect(getStatus).toHaveBeenCalled();
    expect(saveMetadata).not.toHaveBeenCalled();
    expect(saveState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'error',
        error: 'Homepage could not be analyzed from scraped pages',
        errorCode: 'import_failed',
        userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
      })
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'rebuild-orchestration.homepage-analysis-skipped',
      expect.objectContaining({
        appId: 'app-123',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        successfulUrls: ['https://example.com/index.htm'],
        homepageCandidates: [
          {
            url: 'https://example.com/index.htm',
            isHomepage: false,
            success: true,
            hasContent: true,
            error: undefined
          }
        ]
      })
    );
  });

  it('passes REBUILD_SCRAPE_BATCH_DELAY_MS and REBUILD_SCRAPE_CONCURRENCY to scrapeMultiplePages', async function scrapeEnvOptions() {
    const prevDelay = process.env.REBUILD_SCRAPE_BATCH_DELAY_MS;
    const prevConc = process.env.REBUILD_SCRAPE_CONCURRENCY;
    process.env.REBUILD_SCRAPE_BATCH_DELAY_MS = '3333';
    process.env.REBUILD_SCRAPE_CONCURRENCY = '12';

    const scrapeSpy = vi.spyOn(WebsiteScraperDriver.prototype, 'scrapeMultiplePages').mockResolvedValue({
      success: true,
      totalPages: 1,
      successfulPages: 1,
      failedPages: 0,
      pages: [
        {
          url: 'https://example.com/',
          success: true,
          sanitizedContent: '<html><title>Home</title></html>',
          html: '<html><title>Home</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        }
      ],
      assets: []
    } as never);

    try {
      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p',
        targetAudience: 'a',
        brandVoice: 'b',
        designStyle: 'd',
        colorPalette: { primary: [], secondary: [], accent: [] },
        typography: { headingFonts: [], bodyFonts: [] },
        scrapedAt: new Date().toISOString(),
        version: '1',
        sourceUrl: ''
      } as never);

      const emptyManifest = {
        assets: [],
        totalAssets: 0,
        byType: { image: 0, font: 0, icon: 0, other: 0 },
        generatedAt: new Date().toISOString()
      };
      vi.spyOn(AssetProcessingService.prototype, 'process').mockResolvedValue(emptyManifest as never);

      const service = new RebuildOrchestrationService('/tmp/test-app-scrape-env');
      const state = {
        appId: 'app-env',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: {
          total: 0,
          completed: 0
        },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      vi.spyOn(SitemapDiscoveryService.prototype, 'discover').mockResolvedValue({
        success: true,
        pages: [
          {
            url: 'https://example.com/',
            priority: 1,
            source: 'crawl',
            isBlog: false
          }
        ],
        totalPages: 1
      });

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'savePage').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyze: (a: string, u: string) => Promise<void> }).scrapeAndAnalyze(
        'app-env',
        'https://example.com'
      );

      expect(scrapeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          includeAssets: true,
          rateLimit: 3333,
          concurrency: 12
        })
      );
    } finally {
      scrapeSpy.mockRestore();
      if (prevDelay === undefined) {
        delete process.env.REBUILD_SCRAPE_BATCH_DELAY_MS;
      } else {
        process.env.REBUILD_SCRAPE_BATCH_DELAY_MS = prevDelay;
      }
      if (prevConc === undefined) {
        delete process.env.REBUILD_SCRAPE_CONCURRENCY;
      } else {
        process.env.REBUILD_SCRAPE_CONCURRENCY = prevConc;
      }
    }
  });

  it('uses default scrape batch delay when REBUILD_SCRAPE_BATCH_DELAY_MS is invalid', async function invalidScrapeDelay() {
    const prevDelay = process.env.REBUILD_SCRAPE_BATCH_DELAY_MS;
    process.env.REBUILD_SCRAPE_BATCH_DELAY_MS = 'not-a-number';

    const scrapeSpy = vi.spyOn(WebsiteScraperDriver.prototype, 'scrapeMultiplePages').mockResolvedValue({
      success: true,
      totalPages: 1,
      successfulPages: 1,
      failedPages: 0,
      pages: [
        {
          url: 'https://example.com/',
          success: true,
          sanitizedContent: '<html><title>Home</title></html>',
          html: '<html><title>Home</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        }
      ],
      assets: []
    } as never);

    try {
      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p',
        targetAudience: 'a',
        brandVoice: 'b',
        designStyle: 'd',
        colorPalette: { primary: [], secondary: [], accent: [] },
        typography: { headingFonts: [], bodyFonts: [] },
        scrapedAt: new Date().toISOString(),
        version: '1',
        sourceUrl: ''
      } as never);

      const emptyManifest = {
        assets: [],
        totalAssets: 0,
        byType: { image: 0, font: 0, icon: 0, other: 0 },
        generatedAt: new Date().toISOString()
      };
      vi.spyOn(AssetProcessingService.prototype, 'process').mockResolvedValue(emptyManifest as never);

      const service = new RebuildOrchestrationService('/tmp/test-app-invalid-delay');
      const state = {
        appId: 'app-delay',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: {
          total: 0,
          completed: 0
        },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      vi.spyOn(SitemapDiscoveryService.prototype, 'discover').mockResolvedValue({
        success: true,
        pages: [
          {
            url: 'https://example.com/',
            priority: 1,
            source: 'crawl',
            isBlog: false
          }
        ],
        totalPages: 1
      });

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'savePage').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyze: (a: string, u: string) => Promise<void> }).scrapeAndAnalyze(
        'app-delay',
        'https://example.com'
      );

      expect(scrapeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          rateLimit: 600
        })
      );
    } finally {
      scrapeSpy.mockRestore();
      if (prevDelay === undefined) {
        delete process.env.REBUILD_SCRAPE_BATCH_DELAY_MS;
      } else {
        process.env.REBUILD_SCRAPE_BATCH_DELAY_MS = prevDelay;
      }
    }
  });

  it('runs homepage asset process in parallel with analyzer then merge pass for other pages', async function parallelHomeAndMerge() {
    const scrapeSpy = vi.spyOn(WebsiteScraperDriver.prototype, 'scrapeMultiplePages').mockResolvedValue({
      success: true,
      totalPages: 2,
      successfulPages: 2,
      failedPages: 0,
      pages: [
        {
          url: 'https://example.com/',
          success: true,
          sanitizedContent: '<html><title>Home</title></html>',
          html: '<html><title>Home</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        },
        {
          url: 'https://example.com/about',
          success: true,
          sanitizedContent: '<html><title>About</title></html>',
          html: '<html><title>About</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        }
      ],
      assets: [
        {
          url: 'https://example.com/home.png',
          type: 'image' as const,
          sourceUrl: 'https://example.com/'
        },
        {
          url: 'https://example.com/other.png',
          type: 'image' as const,
          sourceUrl: 'https://example.com/about'
        }
      ]
    } as never);

    const emptyManifest = {
      assets: [],
      totalAssets: 0,
      byType: { image: 0, font: 0, icon: 0, other: 0 },
      generatedAt: new Date().toISOString()
    };
    const processSpy = vi
      .spyOn(AssetProcessingService.prototype, 'process')
      .mockResolvedValue(emptyManifest as never);

    try {
      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p',
        targetAudience: 'a',
        brandVoice: 'b',
        designStyle: 'd',
        colorPalette: { primary: [], secondary: [], accent: [] },
        typography: { headingFonts: [], bodyFonts: [] },
        scrapedAt: new Date().toISOString(),
        version: '1',
        sourceUrl: ''
      } as never);

      const service = new RebuildOrchestrationService('/tmp/test-app-parallel');
      const state = {
        appId: 'app-par',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: {
          total: 0,
          completed: 0
        },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      vi.spyOn(SitemapDiscoveryService.prototype, 'discover').mockResolvedValue({
        success: true,
        pages: [
          {
            url: 'https://example.com/',
            priority: 1,
            source: 'crawl',
            isBlog: false
          },
          {
            url: 'https://example.com/about',
            priority: 0.8,
            source: 'crawl',
            isBlog: false
          }
        ],
        totalPages: 2
      });

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'savePage').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyze: (a: string, u: string) => Promise<void> }).scrapeAndAnalyze(
        'app-par',
        'https://example.com'
      );

      expect(processSpy).toHaveBeenCalledTimes(2);
      expect(processSpy.mock.calls[0]?.[2]).toEqual({ merge: false });
      expect(processSpy.mock.calls[1]?.[2]).toEqual({ merge: true });
      expect(scrapeSpy).toHaveBeenCalled();
    } finally {
      processSpy.mockRestore();
      scrapeSpy.mockRestore();
    }
  });

  it('pre-analyzes homepage assets with the process-returned manifest during scrape', async function preAnalyzeHomepage() {
    const homeManifest = {
      assets: [
        {
          url: 'https://example.com/home.png',
          localPath: '.source-site/assets/images/home.png',
          type: 'image' as const,
          sourcePages: ['https://example.com/']
        }
      ],
      totalAssets: 1,
      byType: { image: 1, font: 0, icon: 0, other: 0 },
      generatedAt: new Date().toISOString()
    };

    const scrapeSpy = vi.spyOn(WebsiteScraperDriver.prototype, 'scrapeMultiplePages').mockResolvedValue({
      success: true,
      totalPages: 1,
      successfulPages: 1,
      failedPages: 0,
      pages: [
        {
          url: 'https://example.com/',
          success: true,
          sanitizedContent: '<html><title>Home</title></html>',
          html: '<html><title>Home</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        }
      ],
      assets: [
        {
          url: 'https://example.com/home.png',
          type: 'image' as const,
          sourceUrl: 'https://example.com/'
        }
      ]
    } as never);

    const processSpy = vi
      .spyOn(AssetProcessingService.prototype, 'process')
      .mockResolvedValue(homeManifest as never);

    const analyzeSpy = vi
      .spyOn(AssetProcessingService.prototype, 'analyzePageAssets')
      .mockResolvedValue({ pageAssets: homeManifest.assets, analyzedImageCount: 1 } as never);

    try {
      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p',
        targetAudience: 'a',
        brandVoice: 'b',
        designStyle: 'd',
        colorPalette: { primary: [], secondary: [], accent: [] },
        typography: { headingFonts: [], bodyFonts: [] },
        scrapedAt: new Date().toISOString(),
        version: '1',
        sourceUrl: ''
      } as never);

      const service = new RebuildOrchestrationService('/tmp/test-app-preanalyze');
      const state = {
        appId: 'app-pre',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      vi.spyOn(SitemapDiscoveryService.prototype, 'discover').mockResolvedValue({
        success: true,
        pages: [
          { url: 'https://example.com/', priority: 1, source: 'crawl', isBlog: false }
        ],
        totalPages: 1
      });
      const saveState = vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'savePage').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyze: (a: string, u: string) => Promise<void> }).scrapeAndAnalyze(
        'app-pre',
        'https://example.com'
      );

      expect(analyzeSpy).toHaveBeenCalledTimes(1);
      expect(analyzeSpy).toHaveBeenCalledWith('https://example.com/', homeManifest);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'rebuild-orchestration.homepage-assets-pre-analyzed',
        expect.objectContaining({
          appId: 'app-pre',
          pageUrl: 'https://example.com/',
          pageAssetCount: 1,
          analyzedImageCount: 1
        })
      );
      expect(saveState).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'style_questions' })
      );
    } finally {
      analyzeSpy.mockRestore();
      processSpy.mockRestore();
      scrapeSpy.mockRestore();
    }
  });

  it('does not abort orchestration when homepage pre-analysis throws', async function preAnalyzeError() {
    const homeManifest = {
      assets: [],
      totalAssets: 0,
      byType: { image: 0, font: 0, icon: 0, other: 0 },
      generatedAt: new Date().toISOString()
    };

    const scrapeSpy = vi.spyOn(WebsiteScraperDriver.prototype, 'scrapeMultiplePages').mockResolvedValue({
      success: true,
      totalPages: 1,
      successfulPages: 1,
      failedPages: 0,
      pages: [
        {
          url: 'https://example.com/',
          success: true,
          sanitizedContent: '<html><title>Home</title></html>',
          html: '<html><title>Home</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        }
      ],
      assets: [
        {
          url: 'https://example.com/home.png',
          type: 'image' as const,
          sourceUrl: 'https://example.com/'
        }
      ]
    } as never);

    const processSpy = vi
      .spyOn(AssetProcessingService.prototype, 'process')
      .mockResolvedValue(homeManifest as never);

    const analyzeSpy = vi
      .spyOn(AssetProcessingService.prototype, 'analyzePageAssets')
      .mockRejectedValue(new Error('boom'));

    try {
      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p',
        targetAudience: 'a',
        brandVoice: 'b',
        designStyle: 'd',
        colorPalette: { primary: [], secondary: [], accent: [] },
        typography: { headingFonts: [], bodyFonts: [] },
        scrapedAt: new Date().toISOString(),
        version: '1',
        sourceUrl: ''
      } as never);

      const service = new RebuildOrchestrationService('/tmp/test-app-preanalyze-err');
      const state = {
        appId: 'app-pre-err',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      vi.spyOn(SitemapDiscoveryService.prototype, 'discover').mockResolvedValue({
        success: true,
        pages: [
          { url: 'https://example.com/', priority: 1, source: 'crawl', isBlog: false }
        ],
        totalPages: 1
      });
      const saveState = vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'savePage').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyze: (a: string, u: string) => Promise<void> }).scrapeAndAnalyze(
        'app-pre-err',
        'https://example.com'
      );

      expect(analyzeSpy).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'rebuild-orchestration.homepage-assets-pre-analyze-failed',
        expect.objectContaining({
          appId: 'app-pre-err',
          pageUrl: 'https://example.com/',
          error: 'boom'
        })
      );
      expect(saveState).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'style_questions' })
      );
    } finally {
      analyzeSpy.mockRestore();
      processSpy.mockRestore();
      scrapeSpy.mockRestore();
    }
  });

  it('persists siteType from analyzer metadata when scrape completes', async function siteTypeSave() {
    const scrapeSpy = vi.spyOn(WebsiteScraperDriver.prototype, 'scrapeMultiplePages').mockResolvedValue({
      success: true,
      totalPages: 1,
      successfulPages: 1,
      failedPages: 0,
      pages: [
        {
          url: 'https://example.com/',
          success: true,
          sanitizedContent: '<html><title>Home</title></html>',
          html: '<html><title>Home</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        }
      ],
      assets: []
    } as never);

    vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
    vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
    vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
      siteType: 'commerce',
      sourceUrl: '',
      sitePurpose: 'p',
      targetAudience: 'a',
      brandVoice: 'b',
      designStyle: 'd',
      colorPalette: { primary: [], secondary: [], accent: [] },
      typography: { headingFonts: [], bodyFonts: [] },
      scrapedAt: new Date().toISOString(),
      version: '1'
    } as never);

    const emptyManifest = {
      assets: [],
      totalAssets: 0,
      byType: { image: 0, font: 0, icon: 0, other: 0 },
      generatedAt: new Date().toISOString()
    };
    vi.spyOn(AssetProcessingService.prototype, 'process').mockResolvedValue(emptyManifest as never);
    vi.spyOn(AssetProcessingService.prototype, 'analyzePageAssets').mockResolvedValue({
      pageAssets: [],
      analyzedImageCount: 0
    } as never);

    const service = new RebuildOrchestrationService('/tmp/test-app-site-type');
    const state = {
      appId: 'app-site-type',
      sourceUrl: 'https://example.com',
      rootPath: '/',
      status: 'scraping' as const,
      scrapingProgress: {
        total: 0,
        completed: 0
      },
      pagesBuilt: [],
      currentPage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    vi.spyOn(SitemapDiscoveryService.prototype, 'discover').mockResolvedValue({
      success: true,
      pages: [
        {
          url: 'https://example.com/',
          priority: 1,
          source: 'crawl',
          isBlog: false
        }
      ],
      totalPages: 1
    });

    vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
    vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
    vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
    vi.spyOn(service as never, 'savePage').mockResolvedValue(undefined);
    const saveMetadata = vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

    await (service as never as { scrapeAndAnalyze: (a: string, u: string) => Promise<void> }).scrapeAndAnalyze(
      'app-site-type',
      'https://example.com'
    );

    expect(saveMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        siteType: 'commerce',
        sourceUrl: 'https://example.com'
      })
    );

    scrapeSpy.mockRestore();
  });

  describe('scrapeAndAnalyzeWithAtlas', () => {
    const buildCrawlOutput = (overrides: Partial<Awaited<ReturnType<AtlasCrawlerAdapter['crawlSite']>>> = {}) => ({
      sitemapData: {
        pages: [],
        totalPages: 0,
        discoveredAt: new Date().toISOString(),
      },
      pages: [],
      assets: [],
      designTokenMetadata: {},
      navigation: [],
      footerNavigation: [],
      atlasReportedScreenshot: false,
      ...overrides,
    });

    const stubAnalyzer = (): void => {
      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p',
        targetAudience: 'a',
        brandVoice: 'b',
        designStyle: 'd',
        colorPalette: { primary: [], secondary: [], accent: [] },
        typography: { headingFonts: [], bodyFonts: [] },
        scrapedAt: new Date().toISOString(),
        version: '1',
        sourceUrl: '',
      } as never);
    };

    const stubAssetProcessing = (): void => {
      const emptyManifest = {
        assets: [],
        totalAssets: 0,
        byType: { image: 0, font: 0, icon: 0, other: 0 },
        generatedAt: new Date().toISOString(),
      };
      vi.spyOn(AssetProcessingService.prototype, 'process').mockResolvedValue(emptyManifest as never);
    };

    it('filters sitemap and persisted pages by rootPath for sub-path rebuilds', async () => {
      const inStorePages = [
        {
          url: 'https://example.com/store',
          slug: 'store',
          source: 'crawl' as const,
          scraped: true,
          isBlog: false,
        },
        {
          url: 'https://example.com/store/products',
          slug: 'store-products',
          source: 'crawl' as const,
          scraped: true,
          isBlog: false,
        },
      ];
      const outOfRootPage = {
        url: 'https://example.com/about',
        slug: 'about',
        source: 'crawl' as const,
        scraped: true,
        isBlog: false,
      };

      vi.spyOn(AtlasCrawlerAdapter.prototype, 'crawlSite').mockResolvedValue(
        buildCrawlOutput({
          sitemapData: {
            pages: [...inStorePages, outOfRootPage],
            totalPages: 3,
            discoveredAt: new Date().toISOString(),
          },
          pages: [
            { url: 'https://example.com/store', success: true, sanitizedContent: '<html>store</html>', html: '<html>store</html>' },
            { url: 'https://example.com/store/products', success: true, sanitizedContent: '<html>products</html>', html: '<html>products</html>' },
            { url: 'https://example.com/about', success: true, sanitizedContent: '<html>about</html>', html: '<html>about</html>' },
          ],
        }) as never
      );

      stubAnalyzer();
      stubAssetProcessing();

      const service = new RebuildOrchestrationService('/tmp/test-app-atlas-subpath');
      const state = {
        appId: 'app-subpath',
        sourceUrl: 'https://example.com/store',
        rootPath: '/store',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      const saveSitemap = vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      const persistScrapedPages = vi.spyOn(service as never, 'persistScrapedPages').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyzeWithAtlas: (a: string, u: string) => Promise<void> })
        .scrapeAndAnalyzeWithAtlas('app-subpath', 'https://example.com/store');

      const sitemap = saveSitemap.mock.calls[0]?.[0] as { pages: { url: string }[]; totalPages: number };
      expect(sitemap.pages.map(p => p.url)).toEqual([
        'https://example.com/store',
        'https://example.com/store/products',
      ]);
      expect(sitemap.totalPages).toBe(2);

      const persistedPages = persistScrapedPages.mock.calls[0]?.[1] as { url: string }[];
      expect(persistedPages.map(p => p.url)).toEqual([
        'https://example.com/store',
        'https://example.com/store/products',
      ]);
    });

    it('warns when atlas reports a screenshot but fetch produced no base64', async () => {
      vi.spyOn(AtlasCrawlerAdapter.prototype, 'crawlSite').mockResolvedValue(
        buildCrawlOutput({
          sitemapData: {
            pages: [
              {
                url: 'https://example.com/',
                slug: 'homepage',
                source: 'crawl' as const,
                scraped: true,
                isBlog: false,
              },
            ],
            totalPages: 1,
            discoveredAt: new Date().toISOString(),
          },
          pages: [
            { url: 'https://example.com/', success: true, sanitizedContent: '<html>home</html>', html: '<html>home</html>' },
          ],
          atlasReportedScreenshot: true,
          // homepageScreenshotBase64 omitted on purpose to simulate a failed screenshot fetch
        }) as never
      );

      stubAnalyzer();
      stubAssetProcessing();

      const service = new RebuildOrchestrationService('/tmp/test-app-atlas-screenshot-miss');
      const state = {
        appId: 'app-shotmiss',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'persistScrapedPages').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyzeWithAtlas: (a: string, u: string) => Promise<void> })
        .scrapeAndAnalyzeWithAtlas('app-shotmiss', 'https://example.com');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'rebuild-orchestration.atlas-screenshot-missing',
        expect.objectContaining({
          appId: 'app-shotmiss',
          homepageUrl: 'https://example.com/',
        })
      );
    });

    it('propagates failureReason from adapter into atlas-screenshot-missing warn', async () => {
      vi.spyOn(AtlasCrawlerAdapter.prototype, 'crawlSite').mockResolvedValue(
        buildCrawlOutput({
          sitemapData: {
            pages: [
              { url: 'https://example.com/', slug: 'homepage', source: 'crawl' as const, scraped: true, isBlog: false },
            ],
            totalPages: 1,
            discoveredAt: new Date().toISOString(),
          },
          pages: [
            { url: 'https://example.com/', success: true, sanitizedContent: '<html>home</html>', html: '<html>home</html>' },
          ],
          atlasReportedScreenshot: true,
          homepageScreenshotFailureReason: 'content-length-cap',
        }) as never
      );

      stubAnalyzer();
      stubAssetProcessing();

      const service = new RebuildOrchestrationService('/tmp/test-app-atlas-screenshot-reason');
      const state = {
        appId: 'app-shotreason',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'persistScrapedPages').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyzeWithAtlas: (a: string, u: string) => Promise<void> })
        .scrapeAndAnalyzeWithAtlas('app-shotreason', 'https://example.com');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'rebuild-orchestration.atlas-screenshot-missing',
        expect.objectContaining({
          appId: 'app-shotreason',
          homepageUrl: 'https://example.com/',
          failureReason: 'content-length-cap',
        })
      );
    });

    it('marks workflow as import_failed when no atlas page matches homepage', async () => {
      // Atlas-path equivalent of the legacy "import_failed when no scraped page
      // matches homepage" test. Without this, a crawl that returns only sub-
      // pages (no '/' content) would silently fail later in the pipeline.
      vi.spyOn(AtlasCrawlerAdapter.prototype, 'crawlSite').mockResolvedValue(
        buildCrawlOutput({
          sitemapData: {
            pages: [
              { url: 'https://example.com/about', slug: 'about', source: 'crawl' as const, scraped: true, isBlog: false },
            ],
            totalPages: 1,
            discoveredAt: new Date().toISOString(),
          },
          pages: [
            { url: 'https://example.com/about', success: true, sanitizedContent: '<html>about</html>', html: '<html>about</html>' },
          ],
        }) as never
      );

      stubAnalyzer();
      stubAssetProcessing();

      const service = new RebuildOrchestrationService('/tmp/test-app-atlas-no-home');
      const state = {
        appId: 'app-nohome',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      const saveState = vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'persistScrapedPages').mockResolvedValue(undefined);
      const saveMetadata = vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyzeWithAtlas: (a: string, u: string) => Promise<void> })
        .scrapeAndAnalyzeWithAtlas('app-nohome', 'https://example.com');

      expect(saveMetadata).not.toHaveBeenCalled();
      expect(saveState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'error',
          errorCode: 'import_failed',
          userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
        })
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'rebuild-orchestration.atlas-homepage-not-found',
        expect.any(Object),
      );
    });

    it('atlas designTokenMetadata overrides AI-guessed colorPalette and typography', async () => {
      const atlasPalette = { primary: ['#ff0000'], secondary: ['#00ff00'], accent: ['#0000ff'] };
      const atlasTypography = { headingFonts: ['Inter'], bodyFonts: ['Open Sans'] };
      const atlasContact = { phones: [{ number: '8005551234' }] };
      const atlasFooter = [{ label: 'Privacy', url: '/privacy', isExternal: false }];

      vi.spyOn(AtlasCrawlerAdapter.prototype, 'crawlSite').mockResolvedValue(
        buildCrawlOutput({
          sitemapData: {
            pages: [{ url: 'https://example.com/', slug: 'homepage', source: 'crawl' as const, scraped: true, isBlog: false }],
            totalPages: 1,
            discoveredAt: new Date().toISOString(),
          },
          pages: [
            { url: 'https://example.com/', success: true, sanitizedContent: '<html>home</html>', html: '<html>home</html>' },
          ],
          designTokenMetadata: { colorPalette: atlasPalette, typography: atlasTypography },
          contact: atlasContact,
          footerNavigation: atlasFooter,
        }) as never
      );

      // Analyzer returns DIFFERENT palette/typography to verify atlas overrides win.
      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p',
        targetAudience: 'a',
        brandVoice: 'b',
        designStyle: 'd',
        colorPalette: { primary: ['#aiwrong'], secondary: ['#aiwrong2'], accent: ['#aiwrong3'] },
        typography: { headingFonts: ['AIChose'], bodyFonts: ['AIChoseBody'] },
        scrapedAt: new Date().toISOString(),
        version: '1',
        sourceUrl: '',
      } as never);
      stubAssetProcessing();

      const service = new RebuildOrchestrationService('/tmp/test-app-atlas-merge');
      const state = {
        appId: 'app-merge',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'persistScrapedPages').mockResolvedValue(undefined);
      const saveMetadata = vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyzeWithAtlas: (a: string, u: string) => Promise<void> })
        .scrapeAndAnalyzeWithAtlas('app-merge', 'https://example.com');

      expect(saveMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          colorPalette: atlasPalette,
          typography: atlasTypography,
          contact: atlasContact,
          footerNavigation: atlasFooter,
          sourceUrl: 'https://example.com',
        }),
      );
    });

    it('falls back to AI palette/typography when atlas designTokenMetadata is empty', async () => {
      const aiPalette = { primary: ['#aiprimary'], secondary: ['#aisec'], accent: ['#aiaccent'] };
      const aiTypography = { headingFonts: ['AIHeading'], bodyFonts: ['AIBody'] };

      vi.spyOn(AtlasCrawlerAdapter.prototype, 'crawlSite').mockResolvedValue(
        buildCrawlOutput({
          sitemapData: {
            pages: [{ url: 'https://example.com/', slug: 'homepage', source: 'crawl' as const, scraped: true, isBlog: false }],
            totalPages: 1,
            discoveredAt: new Date().toISOString(),
          },
          pages: [
            { url: 'https://example.com/', success: true, sanitizedContent: '<html>home</html>', html: '<html>home</html>' },
          ],
          // designTokenMetadata empty (atlas didn't extract them) — AI metadata should win.
        }) as never
      );

      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p',
        targetAudience: 'a',
        brandVoice: 'b',
        designStyle: 'd',
        colorPalette: aiPalette,
        typography: aiTypography,
        scrapedAt: new Date().toISOString(),
        version: '1',
        sourceUrl: '',
      } as never);
      stubAssetProcessing();

      const service = new RebuildOrchestrationService('/tmp/test-app-atlas-aifallback');
      const state = {
        appId: 'app-aifb',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'persistScrapedPages').mockResolvedValue(undefined);
      const saveMetadata = vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyzeWithAtlas: (a: string, u: string) => Promise<void> })
        .scrapeAndAnalyzeWithAtlas('app-aifb', 'https://example.com');

      const savedMetadata = saveMetadata.mock.calls[0]?.[0] as { colorPalette: unknown; typography: unknown; contact?: unknown; footerNavigation?: unknown };
      expect(savedMetadata.colorPalette).toEqual(aiPalette);
      expect(savedMetadata.typography).toEqual(aiTypography);
      // contact and footerNavigation are NOT attached when atlas didn't supply them.
      expect(savedMetadata.contact).toBeUndefined();
      expect(savedMetadata.footerNavigation).toBeUndefined();
    });

    it('prefers crawlOutput.homepageScreenshotBase64 over homePage.screenshotBase64', async () => {
      const atlasShot = 'data:image/png;base64,QVRMQVNTSE9U'; // "ATLASSHOT"
      const homepageShot = 'data:image/png;base64,SE9NRVBBR0VTSE9U'; // "HOMEPAGESHOT"

      vi.spyOn(AtlasCrawlerAdapter.prototype, 'crawlSite').mockResolvedValue(
        buildCrawlOutput({
          sitemapData: {
            pages: [{ url: 'https://example.com/', slug: 'homepage', source: 'crawl' as const, scraped: true, isBlog: false }],
            totalPages: 1,
            discoveredAt: new Date().toISOString(),
          },
          pages: [
            {
              url: 'https://example.com/',
              success: true,
              sanitizedContent: '<html>home</html>',
              html: '<html>home</html>',
              screenshotBase64: homepageShot,
            },
          ],
          homepageScreenshotBase64: atlasShot,
          atlasReportedScreenshot: true,
        }) as never
      );

      vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
      vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
      const analyzeSpy = vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
        sitePurpose: 'p', targetAudience: 'a', brandVoice: 'b', designStyle: 'd',
        colorPalette: { primary: [], secondary: [], accent: [] },
        typography: { headingFonts: [], bodyFonts: [] },
        scrapedAt: new Date().toISOString(), version: '1', sourceUrl: '',
      } as never);
      stubAssetProcessing();

      const service = new RebuildOrchestrationService('/tmp/test-app-atlas-shot-precedence');
      const state = {
        appId: 'app-shotprec',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'scraping' as const,
        scrapingProgress: { total: 0, completed: 0 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
      vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'persistScrapedPages').mockResolvedValue(undefined);
      vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

      await (service as never as { scrapeAndAnalyzeWithAtlas: (a: string, u: string) => Promise<void> })
        .scrapeAndAnalyzeWithAtlas('app-shotprec', 'https://example.com');

      // analyze is called with (homepageContent, screenshot). The crawlOutput
      // screenshot must win over the page-level fallback.
      expect(analyzeSpy).toHaveBeenCalledWith(expect.any(String), atlasShot);
    });
  });

  it('deduplicates pages by slug before scraping to prevent file collisions', async () => {
    // Two URLs that both resolve to slug "homepage" (cross-domain redirect scenario)
    vi.spyOn(SitemapDiscoveryService.prototype, 'discover').mockResolvedValue({
      success: true,
      pages: [
        { url: 'https://foo.com/', priority: 1, source: 'crawl' },
        { url: 'https://bar.com/about', priority: 0.8, source: 'crawl' },
        { url: 'https://bar.com/', priority: 0.5, source: 'crawl' },
      ],
      totalPages: 3
    });

    const scrapeSpy = vi.spyOn(WebsiteScraperDriver.prototype, 'scrapeMultiplePages').mockResolvedValue({
      success: true,
      totalPages: 2,
      successfulPages: 2,
      failedPages: 0,
      pages: [
        {
          url: 'https://bar.com/about',
          success: true,
          sanitizedContent: '<html><title>About</title></html>',
          html: '<html><title>About</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        },
        {
          url: 'https://bar.com/',
          success: true,
          sanitizedContent: '<html><title>Home</title></html>',
          html: '<html><title>Home</title></html>',
          screenshotBase64: 'data:image/png;base64,aGVsbG8='
        }
      ],
      assets: []
    } as never);

    vi.spyOn(SiteAnalyzerAgent.prototype, 'initialize').mockResolvedValue(undefined as never);
    vi.spyOn(SiteAnalyzerAgent.prototype, 'cleanup').mockResolvedValue(undefined as never);
    vi.spyOn(SiteAnalyzerAgent.prototype, 'analyze').mockResolvedValue({
      sitePurpose: 'p', targetAudience: 'a', brandVoice: 'b', designStyle: 'd',
      colorPalette: { primary: [], secondary: [], accent: [] },
      typography: { headingFonts: [], bodyFonts: [] },
      scrapedAt: new Date().toISOString(), version: '1', sourceUrl: '', siteType: 'content'
    } as never);

    const service = new RebuildOrchestrationService('/tmp/test-slug-dedup');
    const state = {
      appId: 'app-dedup',
      sourceUrl: 'https://foo.com',
      rootPath: '/',
      status: 'scraping' as const,
      scrapingProgress: { total: 0, completed: 0 },
      pagesBuilt: [],
      currentPage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    vi.spyOn(service as never, 'getStatus').mockResolvedValue(state);
    vi.spyOn(service as never, 'saveState').mockResolvedValue(undefined);
    vi.spyOn(service as never, 'saveSitemap').mockResolvedValue(undefined);
    vi.spyOn(service as never, 'savePage').mockResolvedValue(undefined);
    vi.spyOn(service as never, 'saveMetadata').mockResolvedValue(undefined);

    await (service as never as { scrapeAndAnalyze: (a: string, u: string) => Promise<void> }).scrapeAndAnalyze(
      'app-dedup',
      'https://foo.com'
    );

    // Should only scrape 2 URLs (foo.com/ deduped with bar.com/ → bar.com/ wins)
    const calledUrls = scrapeSpy.mock.calls[0]?.[0]?.urls as string[];
    expect(calledUrls).toHaveLength(2);
    expect(calledUrls).toContain('https://bar.com/');
    expect(calledUrls).toContain('https://bar.com/about');
    expect(calledUrls).not.toContain('https://foo.com/');

    scrapeSpy.mockRestore();
  });
});
