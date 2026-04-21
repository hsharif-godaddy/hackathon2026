import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SiteAnalyzerAgent } from '../../agents/site-analyzer-agent.js';
import { WebsiteScraperDriver } from '../../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import {
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
} from '../../types/rebuild.js';
import { AssetProcessingService } from '../AssetProcessingService.js';
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
});
