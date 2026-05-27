import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SiteAnalyzerAgent } from '../../agents/site-analyzer-agent.js';
import { WebsiteScraperDriver } from '../../tools/ai-lib-tools/drivers/website-scraper-driver.js';
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

describe('RebuildOrchestrationService > slug dedup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.debug.mockReset();
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
