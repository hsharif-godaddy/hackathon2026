import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
} from '../../types/rebuild.js';
import { RebuildOrchestrationService } from '../RebuildOrchestrationService.js';
import { SitemapDiscoveryService } from '../SitemapDiscoveryService.js';
import { WebsiteScraperDriver } from '../../tools/ai-lib-tools/drivers/website-scraper-driver.js';

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
});
