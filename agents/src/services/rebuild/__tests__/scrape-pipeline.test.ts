import { describe, expect, it, vi } from 'vitest';

import { SiteAnalyzerAgent } from '../../../agents/site-analyzer-agent.js';
import type { PageScrapeResult } from '../../../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import type { RebuildWorkflowState, SitemapData, SitemapPage } from '../../../types/rebuild.js';
import { AssetProcessingService } from '../../AssetProcessingService.js';
import { AtlasCrawlerAdapter } from '../../AtlasCrawlerAdapter.js';
import { bucketAssetsForProcessing, ScrapePipeline } from '../scrape-pipeline.js';

// Static imports + vi.mocked() (not dynamic await import + resetModules): the
// hoisted vi.mock applies to these imports deterministically, so the mocks are
// always in place regardless of what other test files loaded first. The dynamic
// pattern was flaky under vitest 4 in the full CI suite (real crawlSite ran).
vi.mock('../../AtlasCrawlerAdapter.js', () => ({ AtlasCrawlerAdapter: vi.fn() }));
vi.mock('../../../agents/site-analyzer-agent.js', () => ({ SiteAnalyzerAgent: vi.fn() }));
vi.mock('../../AssetProcessingService.js', () => ({ AssetProcessingService: vi.fn() }));

describe('bucketAssetsForProcessing', () => {
  const homePageUrl = 'https://example.com/';

  it('returns empty buckets for empty input', () => {
    const result = bucketAssetsForProcessing([], homePageUrl);
    expect(result.assetMap.size).toBe(0);
    expect(result.homeAssets).toEqual([]);
    expect(result.otherAssets).toEqual([]);
  });

  it('builds an assetMap of url → sourceUrl[] (multi-page references coalesce)', () => {
    const assets = [
      { url: 'https://example.com/logo.png', sourceUrl: 'https://example.com/' },
      { url: 'https://example.com/logo.png', sourceUrl: 'https://example.com/about' },
      { url: 'https://example.com/hero.jpg', sourceUrl: 'https://example.com/' },
    ];
    const { assetMap } = bucketAssetsForProcessing(assets, homePageUrl);
    expect(assetMap.get('https://example.com/logo.png')).toEqual([
      'https://example.com/',
      'https://example.com/about',
    ]);
    expect(assetMap.get('https://example.com/hero.jpg')).toEqual(['https://example.com/']);
  });

  it('splits assets by sourceUrl into home vs other based on homePageUrl', () => {
    const assets = [
      { url: 'a', sourceUrl: 'https://example.com/' },
      { url: 'b', sourceUrl: 'https://example.com/about' },
      { url: 'c', sourceUrl: 'https://example.com/' },
      { url: 'd', sourceUrl: 'https://example.com/contact' },
    ];
    const { homeAssets, otherAssets } = bucketAssetsForProcessing(assets, homePageUrl);
    expect(homeAssets.map(a => a.url)).toEqual(['a', 'c']);
    expect(otherAssets.map(a => a.url)).toEqual(['b', 'd']);
  });

  it('does NOT dedupe within buckets — preserves the asymmetric-dedupe contract', () => {
    // Legacy callers dedupe via dedupeExtractedAssetRows; Atlas callers don't
    // (Atlas adapter already emits a deduped stream). bucketAssetsForProcessing
    // returns raw arrays in BOTH buckets so each caller chooses.
    const assets = [
      { url: 'logo.png', sourceUrl: 'https://example.com/' },
      { url: 'logo.png', sourceUrl: 'https://example.com/' }, // duplicate
      { url: 'about.png', sourceUrl: 'https://example.com/about' },
      { url: 'about.png', sourceUrl: 'https://example.com/about' }, // duplicate
    ];
    const { homeAssets, otherAssets } = bucketAssetsForProcessing(assets, homePageUrl);
    expect(homeAssets).toHaveLength(2); // not deduped
    expect(otherAssets).toHaveLength(2); // not deduped
  });

  it('treats normalized-page-key matches as home — strips trailing slash variations', () => {
    // normalizeRebuildPageKey collapses trailing slash; both should bucket as home.
    const assets = [
      { url: 'a', sourceUrl: 'https://example.com/' },
      { url: 'b', sourceUrl: 'https://example.com' },
    ];
    const { homeAssets } = bucketAssetsForProcessing(assets, 'https://example.com/');
    expect(homeAssets.map(a => a.url).sort()).toEqual(['a', 'b']);
  });
});

describe('ScrapePipeline.runAtlas — homepage-first path', () => {
  it('persists only inner pages post-crawl when homepage callback fires', async () => {
    const { pipeline, persistScrapedPages, saveState } = setupAtlasPipeline({
      fullSitemapPages: [
        sitemapEntry('https://example.com/', 'homepage'),
        sitemapEntry('https://example.com/about', 'about'),
      ],
      fullPages: [
        scrapedPage('https://example.com/', '<h1>Home</h1>'),
        scrapedPage('https://example.com/about', '<h1>About</h1>'),
      ],
    });

    await pipeline.run('test-app', 'https://example.com');

    // Homepage persisted in the callback (first persist call).
    expect(persistScrapedPages).toHaveBeenCalledTimes(2);
    expect(persistScrapedPages.mock.calls[0][1]).toHaveLength(1);
    expect(persistScrapedPages.mock.calls[0][1][0].url).toBe('https://example.com/');

    // Inner pages persisted post-crawl (second persist call).
    expect(persistScrapedPages.mock.calls[1][1]).toHaveLength(1);
    expect(persistScrapedPages.mock.calls[1][1][0].url).toBe('https://example.com/about');

    // State transitioned to style_questions during the callback.
    const styleQuestionsCall = saveState.mock.calls.find(
      (call: unknown[]) => (call[0] as { status: string }).status === 'style_questions',
    );
    expect(styleQuestionsCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Shared harness for runAtlas tests (findings 1–4). Each test customizes the
// crawl output, the homepage-callback payload, and the workflow-state callbacks.
// ---------------------------------------------------------------------------

const ANALYZER_RESULT = {
  sourceUrl: 'https://example.com',
  sitePurpose: 'Test',
  targetAudience: 'Testers',
  brandVoice: 'Professional',
  designStyle: 'Modern',
  colorPalette: { primary: [], secondary: [], accent: [] },
  typography: { headingFonts: [], bodyFonts: [] },
  scrapedAt: '2026-01-01T00:00:00.000Z',
  version: '1',
};

function baseState(overrides: Partial<RebuildWorkflowState> = {}): RebuildWorkflowState {
  return {
    appId: 'test-app',
    sourceUrl: 'https://example.com',
    rootPath: '/',
    status: 'scraping',
    scrapingProgress: { total: 0, completed: 0 },
    pagesBuilt: [],
    currentPage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function scrapedPage(url: string, content: string): PageScrapeResult {
  return { url, success: true, sanitizedContent: content, html: `<html><body>${content}</body></html>` };
}

function sitemapEntry(url: string, slug: string): SitemapPage {
  return { url, slug, source: 'crawl', scraped: true };
}

interface SetupOpts {
  /** The full results returned by crawlSite after the crawl finishes. */
  fullSitemapPages: SitemapPage[];
  fullPages: PageScrapeResult[];
  /** What the homepage-ready callback receives (defaults to first page / first sitemap entry). */
  callbackPages?: PageScrapeResult[];
  callbackSitemapPages?: SitemapPage[];
  /** Override workflow-state / persistence callbacks for race + failure tests. */
  getStatus?: ReturnType<typeof vi.fn>;
  saveState?: ReturnType<typeof vi.fn>;
  analyze?: ReturnType<typeof vi.fn>;
  persistScrapedPages?: ReturnType<typeof vi.fn>;
}

function setupAtlasPipeline(opts: SetupOpts) {
  const fullOutput = {
    sitemapData: {
      pages: opts.fullSitemapPages,
      totalPages: opts.fullSitemapPages.length,
      discoveredAt: '2026-01-01T00:00:00.000Z',
    },
    pages: opts.fullPages,
    assets: [],
    designTokenMetadata: {},
    navigation: [],
    footerNavigation: [],
    homepageScreenshotBase64: undefined,
    atlasReportedScreenshot: false,
  };
  const callbackOutput = {
    ...fullOutput,
    pages: opts.callbackPages ?? [opts.fullPages[0]],
    sitemapData: {
      ...fullOutput.sitemapData,
      pages: opts.callbackSitemapPages ?? [opts.fullSitemapPages[0]],
      totalPages: (opts.callbackSitemapPages ?? [opts.fullSitemapPages[0]]).length,
    },
  };

  const crawlSite = vi.fn().mockImplementation(
    async (_url: string, _o: unknown, cbs?: { onHomepageReady?: (o: unknown) => Promise<void> }) => {
      if (cbs?.onHomepageReady) await cbs.onHomepageReady(callbackOutput);
      return fullOutput;
    },
  );
  // These three are invoked with `new` inside runAtlas, so the mock impl must be
  // a constructable `function` — an arrow fn has no [[Construct]] and throws
  // "is not a constructor" under vitest in CI.
  vi.mocked(AtlasCrawlerAdapter).mockImplementation(function () {
    return { crawlSite } as unknown as AtlasCrawlerAdapter;
  });

  const analyze = opts.analyze ?? vi.fn().mockResolvedValue(ANALYZER_RESULT);
  vi.mocked(SiteAnalyzerAgent).mockImplementation(function () {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      analyze,
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as SiteAnalyzerAgent;
  });

  vi.mocked(AssetProcessingService).mockImplementation(function () {
    return {
      process: vi.fn().mockResolvedValue({ assets: [], totalAssets: 0, byType: { image: 0, font: 0, icon: 0, other: 0 }, generatedAt: '' }),
      analyzePageAssets: vi.fn().mockResolvedValue({ pageAssets: [], analyzedImageCount: 0 }),
    } as unknown as AssetProcessingService;
  });

  const persistScrapedPages = opts.persistScrapedPages ?? vi.fn().mockResolvedValue(undefined);
  const saveState = opts.saveState ?? vi.fn().mockResolvedValue(undefined);
  const saveSitemap = vi.fn().mockResolvedValue(undefined);
  const saveMetadata = vi.fn().mockResolvedValue(undefined);
  const getStatus = opts.getStatus ?? vi.fn().mockImplementation(async () => baseState());

  const deps = {
    appPath: '/tmp/test-app',
    useAtlas: true,
    scraperReason: 'env-override' as const,
    jwtFlag: false,
    envOverride: true,
    getStatus,
    saveState,
    saveSitemap,
    saveMetadata,
    persistScrapedPages,
  };

  const pipeline = new ScrapePipeline(deps);
  return { pipeline, persistScrapedPages, saveState, saveSitemap, saveMetadata, getStatus };
}

describe('ScrapePipeline.runAtlas — finding 1: persist before advertising in sitemap', () => {
  it('persists inner pages before writing the full sitemap that marks them scraped', async () => {
    const home = scrapedPage('https://example.com/', '<h1>Home</h1>');
    const about = scrapedPage('https://example.com/about', '<h1>About</h1>');

    const { pipeline, persistScrapedPages, saveSitemap } = setupAtlasPipeline({
      fullSitemapPages: [
        sitemapEntry('https://example.com/', 'homepage'),
        sitemapEntry('https://example.com/about', 'about'),
      ],
      fullPages: [home, about],
    });

    await pipeline.run('test-app', 'https://example.com');

    // The post-crawl full sitemap (the write that first includes the inner page)
    // must land AFTER the inner page's JSON is persisted — otherwise the selector
    // advertises a page whose file doesn't exist yet and buildPage throws.
    const innerPersistIdx = persistScrapedPages.mock.calls.findIndex(
      c => (c[1] as PageScrapeResult[]).some(p => p.url === 'https://example.com/about'),
    );
    const fullSitemapIdx = saveSitemap.mock.calls.findIndex(
      c => (c[0] as SitemapData).pages.some(p => p.url === 'https://example.com/about'),
    );
    expect(innerPersistIdx).toBeGreaterThanOrEqual(0);
    expect(fullSitemapIdx).toBeGreaterThanOrEqual(0);

    const innerPersistOrder = persistScrapedPages.mock.invocationCallOrder[innerPersistIdx];
    const fullSitemapOrder = saveSitemap.mock.invocationCallOrder[fullSitemapIdx];
    expect(innerPersistOrder).toBeLessThan(fullSitemapOrder);
  });
});

describe('ScrapePipeline.runAtlas — finding 2: callback does not clobber user transitions', () => {
  it('preserves a user submitStylePreferences (status=building) that lands during the homepage callback', async () => {
    const home = scrapedPage('https://example.com/', '<h1>Home</h1>');

    // Disk starts at 'scraping'. While the analyzer runs — the race window —
    // the user submits style preferences, flipping disk to 'building'. A stateful
    // store mirrors the real getStatus/saveState round-trip so a stale closure
    // write is observable.
    let disk: RebuildWorkflowState = baseState();
    const getStatus = vi.fn().mockImplementation(async () => ({ ...disk }));
    const saveState = vi.fn().mockImplementation(async (s: RebuildWorkflowState) => { disk = { ...s }; });
    const analyze = vi.fn().mockImplementation(async () => {
      // Simulate RebuildOrchestrationService.submitStylePreferences firing mid-analyze.
      disk = { ...disk, status: 'building', stylePreferences: { tone: 'bold' } as RebuildWorkflowState['stylePreferences'] };
      return ANALYZER_RESULT;
    });

    const { pipeline } = setupAtlasPipeline({
      fullSitemapPages: [sitemapEntry('https://example.com/', 'homepage')],
      fullPages: [home],
      getStatus,
      saveState,
      analyze,
    });

    await pipeline.run('test-app', 'https://example.com');

    // The callback must not overwrite the user's 'building' status, and must not
    // drop the style preferences they submitted.
    const clobbered = saveState.mock.calls.some(
      c => (c[0] as RebuildWorkflowState).status === 'style_questions',
    );
    expect(clobbered).toBe(false);
    expect(disk.status).toBe('building');
    expect(disk.stylePreferences).toBeDefined();
  });
});

describe('ScrapePipeline.runAtlas — finding 3: failed inner-page persistence is not reported as success', () => {
  it('marks inner pages unscraped and excludes them from the completed count when persistence throws', async () => {
    const home = scrapedPage('https://example.com/', '<h1>Home</h1>');
    const about = scrapedPage('https://example.com/about', '<h1>About</h1>');

    // Homepage persists fine (callback); the inner-page batch throws (post-crawl).
    const persistScrapedPages = vi.fn().mockImplementation(async (_appId: string, pages: PageScrapeResult[]) => {
      if (pages.some(p => p.url === 'https://example.com/about')) {
        throw new Error('disk full');
      }
    });

    const { pipeline, saveSitemap, saveState } = setupAtlasPipeline({
      fullSitemapPages: [
        sitemapEntry('https://example.com/', 'homepage'),
        sitemapEntry('https://example.com/about', 'about'),
      ],
      fullPages: [home, about],
      persistScrapedPages,
    });

    await pipeline.run('test-app', 'https://example.com');

    // The sitemap that includes the inner page must mark it NOT scraped, since
    // its JSON failed to persist — otherwise the selector offers a build that throws.
    const fullSitemapCall = saveSitemap.mock.calls.find(
      c => (c[0] as SitemapData).pages.some(p => p.url === 'https://example.com/about'),
    );
    expect(fullSitemapCall).toBeDefined();
    const pages = (fullSitemapCall![0] as SitemapData).pages;
    expect(pages.find(p => p.url === 'https://example.com/about')?.scraped).toBe(false);
    // Homepage persisted in the callback — it stays scraped.
    expect(pages.find(p => p.url === 'https://example.com/')?.scraped).toBe(true);

    // Progress must count only pages actually on disk (homepage = 1, not 2).
    const finalState = saveState.mock.calls.at(-1)?.[0] as RebuildWorkflowState;
    expect(finalState.scrapingProgress.completed).toBe(1);
  });
});

describe('ScrapePipeline.runAtlas — finding 4: homepage callback writes a homepage-only sitemap', () => {
  it('writes only the homepage entry even when /home returns the full discovered sitemap', async () => {
    const home = scrapedPage('https://example.com/', '<h1>Home</h1>');
    const about = scrapedPage('https://example.com/about', '<h1>About</h1>');

    const { pipeline, saveSitemap } = setupAtlasPipeline({
      fullSitemapPages: [
        sitemapEntry('https://example.com/', 'homepage'),
        sitemapEntry('https://example.com/about', 'about'),
      ],
      fullPages: [home, about],
      callbackPages: [home],
      // Atlas /home does phase-1 discovery, so it may return the full sitemap —
      // not just the homepage. We must not trust it to be homepage-only.
      callbackSitemapPages: [
        sitemapEntry('https://example.com/', 'homepage'),
        sitemapEntry('https://example.com/about', 'about'),
      ],
    });

    await pipeline.run('test-app', 'https://example.com');

    // The FIRST sitemap write (the homepage callback) must list only the
    // homepage — inner pages have no JSON on disk yet during this phase.
    const firstSitemap = saveSitemap.mock.calls[0]?.[0] as SitemapData;
    expect(firstSitemap.pages.map(p => p.url)).toEqual(['https://example.com/']);
  });
});
