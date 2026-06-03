import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { AtlasCrawlResult } from '../../types/atlas-api.js';
import { AtlasCrawlerAdapter } from '../AtlasCrawlerAdapter.js';

vi.mock('@airo/ai-lib', () => ({
  getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token'),
}));

function createMockCrawlResult(overrides: Partial<AtlasCrawlResult> = {}): AtlasCrawlResult {
  return {
    baseUrl: 'https://example.com',
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:01:00Z',
    duration: 60000,
    pages: [
      createMockPage({ url: 'https://example.com/', path: '/' }),
      createMockPage({ url: 'https://example.com/about', path: '/about' }),
      createMockPage({ url: 'https://example.com/services', path: '/services' }),
    ],
    assets: [
      { url: 'https://example.com/hero.jpg', type: 'image', referencedBy: ['https://example.com/'] },
      { url: 'https://example.com/logo.png', type: 'favicon', referencedBy: ['https://example.com/', 'https://example.com/about'] },
      { url: 'https://example.com/style.css', type: 'css', referencedBy: ['https://example.com/'] },
      { url: 'https://example.com/font.woff2', type: 'font', referencedBy: ['https://example.com/'] },
    ],
    state: { visited: [], failed: [], redirects: [], skipped: [] },
    structure: { sitemap: null, hierarchy: {} },
    ...overrides,
  } as AtlasCrawlResult;
}

function createMockPage(overrides: Partial<AtlasCrawlResult['pages'][0]> = {}): AtlasCrawlResult['pages'][0] {
  return {
    url: 'https://example.com/',
    path: '/',
    crawledAt: '2024-01-01T00:00:00Z',
    statusCode: 200,
    depth: 0,
    title: 'Example Site',
    html: '<html><body>Hello</body></html>',
    text: 'Hello world content',
    metadata: { title: 'Example Site', description: 'A test site' },
    links: [],
    ...overrides,
  };
}

describe('AtlasCrawlerAdapter', () => {
  let adapter: AtlasCrawlerAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.ATLAS_API_BASE_URL = 'https://atlas.test.example.com';
    adapter = new AtlasCrawlerAdapter();

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ATLAS_API_BASE_URL;
  });

  describe('crawlSite', () => {
    it('submits job, polls, fetches results, and fetches screenshot', async () => {
      const mockResult = createMockCrawlResult({
        screenshots: [{ path: 'screenshots/job-123/homepage.png', url: 'https://s3.example.com/screenshot.png', format: 'png', size: 1000, viewport: { width: 1440, height: 900 } }],
      });

      // POST /crawl → 202
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'job-123', status: 'pending' }),
      });

      // GET /jobs/job-123 → completed
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'job-123', status: 'completed' }),
      });

      // GET /jobs/job-123/results → CrawlResult
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      // GET screenshot URL → image bytes
      const pngBytes = Buffer.from('fake-png-data');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => pngBytes.buffer,
        headers: new Map([['content-type', 'image/png']]) as any,
      });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.sitemapData.pages).toHaveLength(3);
      expect(output.pages).toHaveLength(3);
      expect(output.assets.length).toBeGreaterThan(0);
      expect(output.homepageScreenshotBase64).toContain('data:image/png;base64,');

      // Verify POST /crawl was called with S2S token
      expect(fetchMock.mock.calls[0][0]).toBe('https://atlas.test.example.com/crawl');
      expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('sso-jwt mock-s2s-token');

      // Verify screenshot was fetched
      expect(fetchMock.mock.calls[3][0]).toBe('https://s3.example.com/screenshot.png');
    });

    it('returns undefined screenshot when no screenshots in result', async () => {
      const mockResult = createMockCrawlResult({ screenshots: undefined });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-1', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-1', status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.homepageScreenshotBase64).toBeUndefined();
      expect(output.atlasReportedScreenshot).toBe(false);
    });

    it('exposes atlasReportedScreenshot=true when url was advertised but fetch failed', async () => {
      const mockResult = createMockCrawlResult({
        screenshots: [{ path: 'screenshots/job-2/homepage.png', url: 'https://s3.example.com/screenshot.png', format: 'png', size: 1000, viewport: { width: 1440, height: 900 } }],
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-2', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-2', status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });
      // Screenshot fetch fails — adapter returns undefined base64 but flag stays true
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404, headers: new Map() as never });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.homepageScreenshotBase64).toBeUndefined();
      expect(output.atlasReportedScreenshot).toBe(true);
    });

    it('throws on job failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'job-fail', status: 'pending' }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'job-fail', status: 'failed', error: 'SSRF blocked' }),
      });

      await expect(adapter.crawlSite('https://example.com')).rejects.toThrow('Atlas crawl failed: SSRF blocked');
    });

    it('throws on submit failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(adapter.crawlSite('https://example.com')).rejects.toThrow('Atlas API submit failed (401)');
    });

    it('fails fast with import_failed when submit response is missing jobId', async () => {
      // Without runtime validation, polling would spin on /jobs/undefined for
      // 5 minutes before timing out. The Zod schema catches the shape mismatch
      // and throws a named import_failed RebuildError at submit time.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'pending' }), // jobId missing
      });

      const promise = adapter.crawlSite('https://example.com');
      await expect(promise).rejects.toThrow('Atlas API returned invalid submit response');
      await expect(promise).rejects.toMatchObject({ code: 'import_failed' });
    });

    it('fails fast with import_failed when results response is missing required arrays', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-x', status: 'pending' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-x', status: 'completed' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ baseUrl: 'https://example.com' }) }); // pages/assets/state/structure missing

      const promise = adapter.crawlSite('https://example.com');
      await expect(promise).rejects.toThrow('Atlas API returned invalid results response');
      await expect(promise).rejects.toMatchObject({ code: 'import_failed' });
    });

    it('fails fast with import_failed when poll response is missing status', async () => {
      // Schema is z.string().min(1) (intentionally open — atlas may introduce
      // new in-progress states like 'homepage_ready'), so an unknown label is
      // accepted and treated as in-progress. The boundary check still rejects
      // a missing/empty status, which would otherwise loop the poller until
      // the 5-min timeout.
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-bad', status: 'pending' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const promise = adapter.crawlSite('https://example.com');
      await expect(promise).rejects.toThrow('Atlas API returned invalid job-status response');
      await expect(promise).rejects.toMatchObject({ code: 'import_failed' });
    });

    it('fails fast with import_failed when results structure is null (z.unknown allowed null)', async () => {
      // Atlas returning `{ ..., structure: null }` previously passed the schema
      // (z.unknown() permits null) and only blew up later when the adapter
      // accessed result.structure.sitemap. The tightened schema now rejects
      // null structure at the boundary.
      const mockResult = {
        baseUrl: 'https://example.com',
        pages: [],
        assets: [],
        structure: null,
      };
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-null-struct', status: 'pending' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const promise = adapter.crawlSite('https://example.com');
      await expect(promise).rejects.toThrow('Atlas API returned invalid results response');
      await expect(promise).rejects.toMatchObject({ code: 'import_failed' });
    });

    it('fails fast with import_failed when Atlas returns malformed JSON (HTML error page)', async () => {
      // If Atlas returns an HTML error page or empty body, response.json()
      // throws SyntaxError. Without the parse-error guard that error escapes
      // parseAtlasJson without the boundary tag, defeating the named-error
      // contract at every call site.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
      });

      const promise = adapter.crawlSite('https://example.com');
      await expect(promise).rejects.toThrow('Atlas API returned invalid submit response');
      await expect(promise).rejects.toMatchObject({ code: 'import_failed' });
    });

    it('invokes onHomepageReady callback when poll returns homepage_ready', async () => {
      const homeResult = createMockCrawlResult({
        pages: [createMockPage({ url: 'https://example.com/', path: '/' })],
      });
      const fullResult = createMockCrawlResult();

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-hp', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'homepage_ready' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => homeResult });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fullResult });

      const onHomepageReady = vi.fn().mockResolvedValue(undefined);
      const output = await adapter.crawlSite('https://example.com', {}, { onHomepageReady });

      expect(onHomepageReady).toHaveBeenCalledTimes(1);
      const homeOutput = onHomepageReady.mock.calls[0][0];
      expect(homeOutput.pages).toHaveLength(1);
      expect(homeOutput.pages[0]?.url).toBe('https://example.com/');
      expect(output.pages).toHaveLength(3);
    });

    it('does not invoke callback when no callbacks provided (backward compat)', async () => {
      const mockResult = createMockCrawlResult();
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-no-cb', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');
      expect(output.pages).toHaveLength(3);
    });

    it('gracefully degrades when /home fetch fails — skips callback, continues to completed', async () => {
      const fullResult = createMockCrawlResult();
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-home-fail', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'homepage_ready' }) });
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Internal error' });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fullResult });

      const onHomepageReady = vi.fn();
      const output = await adapter.crawlSite('https://example.com', {}, { onHomepageReady });

      expect(onHomepageReady).not.toHaveBeenCalled();
      expect(output.pages).toHaveLength(3);
    });

    it('preserves screenshot on final results when /home fetch fails after homepage_ready', async () => {
      const fullResult = createMockCrawlResult({
        pages: [createMockPage({ url: 'https://example.com/', path: '/' })],
        screenshots: [{ path: 'screenshots/job-ss/homepage.png', url: 'https://s3.example.com/shot.png', format: 'png', size: 1000, viewport: { width: 1440, height: 900 } }],
      });

      // Start → homepage_ready → /home 500 → completed → /results → screenshot fetch
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-ss', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'homepage_ready' }) });
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fullResult });
      const pngBytes = Buffer.from('fake-screenshot-png');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => pngBytes.buffer,
        headers: new Map([['content-type', 'image/png']]) as any,
      });

      const onHomepageReady = vi.fn();
      const output = await adapter.crawlSite('https://example.com', {}, { onHomepageReady });

      expect(onHomepageReady).not.toHaveBeenCalled();
      expect(output.homepageScreenshotBase64).toContain('data:image/png;base64,');
    });

    it('invokes homepage callback at most once even if poll sees homepage_ready twice', async () => {
      const homeResult = createMockCrawlResult({
        pages: [createMockPage({ url: 'https://example.com/', path: '/' })],
      });
      const fullResult = createMockCrawlResult();

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-twice', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'homepage_ready' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => homeResult });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'homepage_ready' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fullResult });

      const onHomepageReady = vi.fn().mockResolvedValue(undefined);
      await adapter.crawlSite('https://example.com', {}, { onHomepageReady });

      expect(onHomepageReady).toHaveBeenCalledTimes(1);
    });

    it('propagates callback errors (does not swallow pipeline failures)', async () => {
      const homeResult = createMockCrawlResult({
        pages: [createMockPage({ url: 'https://example.com/', path: '/' })],
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-cb-err', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'homepage_ready' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => homeResult });

      const onHomepageReady = vi.fn().mockRejectedValue(new Error('SiteAnalyzer crashed'));

      await expect(adapter.crawlSite('https://example.com', {}, { onHomepageReady }))
        .rejects.toThrow('SiteAnalyzer crashed');
    });

    it('fetches screenshot on final result when homepage_ready never fires (callback provided but unused)', async () => {
      const mockResult = createMockCrawlResult({
        pages: [createMockPage({ url: 'https://example.com/', path: '/' })],
        screenshots: [{ path: 'screenshots/job-skip/homepage.png', url: 'https://s3.example.com/screenshot.png', format: 'png', size: 1000, viewport: { width: 1440, height: 900 } }],
      });

      // Goes straight to completed — no homepage_ready
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-no-hp', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });
      // Screenshot fetch
      const pngBytes = Buffer.from('fake-png');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => pngBytes.buffer,
        headers: new Map([['content-type', 'image/png']]) as any,
      });

      const onHomepageReady = vi.fn();
      const output = await adapter.crawlSite('https://example.com', {}, { onHomepageReady });

      expect(onHomepageReady).not.toHaveBeenCalled();
      expect(output.homepageScreenshotBase64).toContain('data:image/png;base64,');
    });

    it('propagates page metadata from Atlas pages to PageScrapeResult', async () => {
      const mockResult = createMockCrawlResult({
        pages: [
          createMockPage({
            url: 'https://example.com/',
            path: '/',
            metadata: {
              title: 'Example Site',
              description: 'A great site for examples',
              ogTitle: 'Example | Home',
              ogDescription: 'Welcome to Example',
              ogImage: 'https://example.com/og-hero.jpg',
              canonical: 'https://example.com/',
              keywords: ['example', 'demo'],
            },
          }),
        ],
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-meta', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.pages[0]?.metadata).toEqual({
        title: 'Example Site',
        description: 'A great site for examples',
        ogTitle: 'Example | Home',
        ogDescription: 'Welcome to Example',
        ogImage: 'https://example.com/og-hero.jpg',
        canonicalUrl: 'https://example.com/',
        keywords: ['example', 'demo'],
      });
    });

    it('omits absent metadata fields rather than setting undefined', async () => {
      const mockResult = createMockCrawlResult({
        pages: [
          createMockPage({
            url: 'https://example.com/',
            path: '/',
            metadata: { title: 'Minimal', description: '' },
          }),
        ],
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-min', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.pages[0]?.metadata).toEqual({ title: 'Minimal' });
    });

    it('attaches image placement signals and dimensions from Atlas images to ExtractedAssets', async () => {
      const mockResult = createMockCrawlResult({
        assets: [
          { url: 'https://example.com/logo.png', type: 'image', referencedBy: ['https://example.com/'] },
          { url: 'https://example.com/hero.jpg', type: 'image', referencedBy: ['https://example.com/'] },
        ],
        images: [
          {
            url: 'https://example.com/logo.png',
            alt: 'Company Logo',
            width: 200,
            height: 60,
            sourceUrl: 'https://example.com/',
            element: 'img',
            inHeader: true,
            inFooter: false,
            inFirstSection: false,
            nearH1: false,
            isFirstInContainer: true,
            linkedTo: 'https://example.com/',
            classes: ['site-logo'],
            siblingText: 'Company Name',
          },
          {
            url: 'https://example.com/hero.jpg',
            alt: 'Hero Image',
            width: 1920,
            height: 1080,
            sourceUrl: 'https://example.com/',
            element: 'img',
            inHeader: false,
            inFooter: false,
            inFirstSection: true,
            nearH1: true,
            isFirstInContainer: true,
            classes: ['hero-banner'],
          },
        ],
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-img', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      const logo = output.assets.find(a => a.url === 'https://example.com/logo.png');
      expect(logo?.dimensions).toEqual({ width: 200, height: 60 });
      expect(logo?.placement).toEqual({
        inHeader: true,
        inFooter: false,
        inFirstSection: false,
        nearH1: false,
        isFirstInContainer: true,
        linkedTo: 'https://example.com/',
        classes: ['site-logo'],
        siblingText: 'Company Name',
      });

      const hero = output.assets.find(a => a.url === 'https://example.com/hero.jpg');
      expect(hero?.dimensions).toEqual({ width: 1920, height: 1080 });
      expect(hero?.placement?.inFirstSection).toBe(true);
      expect(hero?.placement?.nearH1).toBe(true);
    });

    it('attaches placement signals to non-manifest SSM images', async () => {
      const mockResult = createMockCrawlResult({
        assets: [],
        images: [
          {
            url: 'https://example.com/bg.jpg',
            width: 800,
            height: 600,
            sourceUrl: 'https://example.com/',
            element: 'img',
            inHeader: false,
            inFooter: false,
            inFirstSection: true,
            nearH1: false,
            isFirstInContainer: false,
          },
        ],
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-ssm', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      const bg = output.assets.find(a => a.url === 'https://example.com/bg.jpg');
      expect(bg?.dimensions).toEqual({ width: 800, height: 600 });
      expect(bg?.placement?.inFirstSection).toBe(true);
    });

    it('extracts typography scale (fontSize, fontWeight, lineHeight, letterSpacing) from Atlas design tokens', async () => {
      const mockResult = createMockCrawlResult({
        visual: {
          designTokens: {
            colors: [],
            typography: [
              { fontFamily: 'Playfair Display', fontSize: '48px', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.02em', elements: ['h1'], role: 'heading' },
              { fontFamily: 'Playfair Display', fontSize: '36px', fontWeight: '700', lineHeight: '1.2', letterSpacing: '-0.01em', elements: ['h2'], role: 'heading' },
              { fontFamily: 'Open Sans', fontSize: '16px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '0', elements: ['p'], role: 'body' },
              { fontFamily: 'Open Sans', fontSize: '14px', fontWeight: '600', lineHeight: '1.4', letterSpacing: '0.01em', elements: ['nav a'], role: 'navigation' },
            ],
            spacing: [],
            borders: { radius: [] },
            shadows: [],
          },
        },
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-typo', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.designTokenMetadata.typography?.scale).toEqual([
        { fontFamily: 'Playfair Display', fontSize: '48px', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.02em', role: 'heading' },
        { fontFamily: 'Playfair Display', fontSize: '36px', fontWeight: '700', lineHeight: '1.2', letterSpacing: '-0.01em', role: 'heading' },
        { fontFamily: 'Open Sans', fontSize: '16px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '0', role: 'body' },
        { fontFamily: 'Open Sans', fontSize: '14px', fontWeight: '600', lineHeight: '1.4', letterSpacing: '0.01em', role: 'navigation' },
      ]);
    });

    it('omits typography metadata when no design tokens present', async () => {
      const mockResult = createMockCrawlResult({
        visual: {
          designTokens: {
            colors: [],
            typography: [],
            spacing: [],
            borders: { radius: [] },
            shadows: [],
          },
        },
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-no-typo', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.designTokenMetadata.typography).toBeUndefined();
    });

    it('applies cleanFontFamily to scale entries', async () => {
      const mockResult = createMockCrawlResult({
        visual: {
          designTokens: {
            colors: [],
            typography: [
              { fontFamily: "'Playfair Display', serif", fontSize: '48px', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.02em', elements: ['h1'], role: 'heading' },
            ],
            spacing: [],
            borders: { radius: [] },
            shadows: [],
          },
        },
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-clean', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.designTokenMetadata.typography?.scale?.[0]?.fontFamily).toBe('Playfair Display');
    });

    it('preserves typography scale when only non-heading/body roles are present', async () => {
      const mockResult = createMockCrawlResult({
        visual: {
          designTokens: {
            colors: [],
            typography: [
              { fontFamily: 'Open Sans', fontSize: '14px', fontWeight: '600', lineHeight: '1.4', letterSpacing: '0.01em', elements: ['nav a'], role: 'navigation' },
              { fontFamily: 'Open Sans', fontSize: '13px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '0', elements: ['button'], role: 'button' },
            ],
            spacing: [],
            borders: { radius: [] },
            shadows: [],
          },
        },
      });

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-nav-only', status: 'pending' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const output = await adapter.crawlSite('https://example.com');

      expect(output.designTokenMetadata.typography).toBeDefined();
      expect(output.designTokenMetadata.typography?.headingFonts).toEqual([]);
      expect(output.designTokenMetadata.typography?.bodyFonts).toEqual([]);
      expect(output.designTokenMetadata.typography?.scale).toHaveLength(2);
      expect(output.designTokenMetadata.typography?.scale?.[0]?.role).toBe('navigation');
    });
  });

  describe('pollUntilComplete', () => {
    let realSetTimeout: typeof global.setTimeout;

    beforeEach(() => {
      // The poll loop sleeps 2s/5s between iterations (POLL_FAST/SLOW_INTERVAL_MS).
      // Letting those sleep for real makes the 10-poll TRANSPORT_FAIL_LIMIT test
      // ~18s on its own. Intercept just those two values; let AbortSignal.timeout
      // and any other timers continue using the real clock.
      realSetTimeout = global.setTimeout;
      vi.spyOn(global, 'setTimeout').mockImplementation((function (fn: () => void, ms?: number) {
        if (ms === 2000 || ms === 5000) {
          Promise.resolve().then(fn);
          return 0 as never;
        }
        return realSetTimeout(fn, ms as never);
      }) as never);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('throws auth error after POLL_AUTH_FAIL_LIMIT consecutive 401s', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-auth', status: 'pending' }) });
      // 3 consecutive 401s — POLL_AUTH_FAIL_LIMIT is 3.
      for (let i = 0; i < 3; i++) {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 401, headers: new Map() as never });
      }
      await expect(adapter.crawlSite('https://example.com')).rejects.toThrow(
        /Atlas API authentication failed.*Verify S2S credentials/,
      );
    });

    it('throws auth error after POLL_AUTH_FAIL_LIMIT consecutive 403s', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-auth-2', status: 'pending' }) });
      for (let i = 0; i < 3; i++) {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 403, headers: new Map() as never });
      }
      await expect(adapter.crawlSite('https://example.com')).rejects.toThrow(
        /Atlas API authentication failed.*403/,
      );
    });

    it('throws transport error after POLL_TRANSPORT_FAIL_LIMIT consecutive 5xx with last-error tail', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-5xx', status: 'pending' }) });
      // POLL_TRANSPORT_FAIL_LIMIT is 10.
      for (let i = 0; i < 10; i++) {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: new Map() as never });
      }
      await expect(adapter.crawlSite('https://example.com')).rejects.toThrow(
        /Atlas API repeatedly failing.*Last error: HTTP 503/,
      );
    });

    it('throws transport error after POLL_TRANSPORT_FAIL_LIMIT consecutive network errors with last-error tail', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-net', status: 'pending' }) });
      for (let i = 0; i < 10; i++) {
        fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      }
      await expect(adapter.crawlSite('https://example.com')).rejects.toThrow(
        /Atlas API unreachable.*Last error: ECONNREFUSED/,
      );
    });

    it('resets transport-failure counter on a successful poll (was the silent-failure bug)', async () => {
      // The previous adapter accumulated transport failures across the entire
      // crawl, so a flaky upstream that recovered would still trip the limit.
      // Verify the counter resets on a successful poll: 5 fails + 1 success +
      // 5 fails should NOT throw before the second batch's 6th failure.
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-flap', status: 'pending' }) });
      // 5 transient 502s
      for (let i = 0; i < 5; i++) {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 502, headers: new Map() as never });
      }
      // Successful poll resets the counter (still pending)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'pending' }),
      });
      // 5 more 502s — total 10, but counter reset, so should NOT throw yet
      for (let i = 0; i < 5; i++) {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 502, headers: new Map() as never });
      }
      // The 11th transient error after reset would still be only 6 consecutive,
      // so the next poll resolves the job:
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed' }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockCrawlResult({ screenshots: undefined }),
      });

      // Should resolve cleanly — verifies counter reset.
      await expect(adapter.crawlSite('https://example.com')).resolves.toBeDefined();
    });

    it('resets auth-failure counter on a successful poll', async () => {
      // 2 × 401 (under limit), then success, then 2 × 401 again. If the
      // counter didn't reset the cumulative 4 wouldn't trip anyway, but the
      // RESET on a successful poll is what protects us from intermittent
      // token-refresh races.
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-auth-reset', status: 'pending' }) });
      for (let i = 0; i < 2; i++) {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 401, headers: new Map() as never });
      }
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) });
      for (let i = 0; i < 2; i++) {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 401, headers: new Map() as never });
      }
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => createMockCrawlResult({ screenshots: undefined }) });

      await expect(adapter.crawlSite('https://example.com')).resolves.toBeDefined();
    });
  });

  describe('fetchHomepageScreenshot caps', () => {
    it('rejects up-front when Content-Length declares > 10MB', async () => {
      const oversized = String(11 * 1024 * 1024); // 11 MB declared
      const mockResult = createMockCrawlResult({
        screenshots: [{ path: 'p', url: 'https://s3.example.com/big.png', format: 'png', size: 999, viewport: { width: 1, height: 1 } }],
      });

      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-big', status: 'pending' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      // Screenshot fetch — oversized declared length
      const headers = new Map([['content-length', oversized]]);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: (k: string) => headers.get(k) ?? null },
        // arrayBuffer should NOT be called when content-length cap rejects up front.
        arrayBuffer: async () => { throw new Error('arrayBuffer should not be called'); },
      });

      const output = await adapter.crawlSite('https://example.com');
      expect(output.homepageScreenshotBase64).toBeUndefined();
      expect(output.atlasReportedScreenshot).toBe(true);
      expect(output.homepageScreenshotFailureReason).toBe('content-length-cap');
    });

    it('rejects after fetch when arrayBuffer byteLength > 10MB (no Content-Length header)', async () => {
      const tooBigBuffer = new ArrayBuffer(11 * 1024 * 1024);
      const mockResult = createMockCrawlResult({
        screenshots: [{ path: 'p', url: 'https://s3.example.com/sneaky.png', format: 'png', size: 999, viewport: { width: 1, height: 1 } }],
      });

      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-sneaky', status: 'pending' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const headers = new Map<string, string>(); // no content-length
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: (k: string) => headers.get(k) ?? null },
        arrayBuffer: async () => tooBigBuffer,
      });

      const output = await adapter.crawlSite('https://example.com');
      expect(output.homepageScreenshotBase64).toBeUndefined();
      expect(output.homepageScreenshotFailureReason).toBe('post-arrayBuffer-cap');
    });

    it('exposes failureReason="http-404" when screenshot URL returns 4xx', async () => {
      const mockResult = createMockCrawlResult({
        screenshots: [{ path: 'p', url: 'https://s3.example.com/missing.png', format: 'png', size: 0, viewport: { width: 1, height: 1 } }],
      });

      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-404', status: 'pending' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockResult })
        .mockResolvedValueOnce({ ok: false, status: 404, headers: new Map() as never });

      const output = await adapter.crawlSite('https://example.com');
      expect(output.homepageScreenshotFailureReason).toBe('http-404');
    });
  });

  describe('resolveBaseUrl', () => {
    it('falls back to dev URL with warn when ATLAS_API_BASE_URL is missing', async () => {
      const warnSpy = vi.fn();
      // Replace adapter's logger via a fresh instance after env removal.
      delete process.env.ATLAS_API_BASE_URL;

      // The resolveBaseUrl warn fires inside the adapter's bound logger.
      // We can't easily intercept the structured logger's warn here without
      // restructuring, so prove the fallback by verifying the resulting
      // baseUrl is the dev URL by inspecting the URL the adapter calls.
      const freshAdapter = new AtlasCrawlerAdapter();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'job-fallback', status: 'pending' }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed' }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockCrawlResult({ screenshots: undefined }),
      });

      await freshAdapter.crawlSite('https://example.com');
      // The first call (POST /crawl) should have used the FALLBACK dev URL.
      expect(fetchMock.mock.calls[0][0]).toBe('https://atlas.dev-gdcorp.tools/crawl');
      // Reset for shared afterEach
      void warnSpy;
    });
  });

  describe('mapToSitemapData', () => {
    it('maps pages to sitemap format with correct slugs', () => {
      const result = createMockCrawlResult();
      const sitemapData = adapter.mapToSitemapData(result, '/');

      expect(sitemapData.pages).toHaveLength(3);
      expect(sitemapData.pages[0].slug).toBe('homepage');
      expect(sitemapData.pages[0].url).toBe('https://example.com/');
      expect(sitemapData.pages[1].slug).toBe('about');
      expect(sitemapData.pages[2].slug).toBe('services');
      expect(sitemapData.totalPages).toBe(3);
    });

    it('uses "sitemap" source when sitemap was found', () => {
      const result = createMockCrawlResult({
        structure: { sitemap: { urls: [], sitemapsProcessed: 1, errors: [] }, hierarchy: {} },
      });
      const sitemapData = adapter.mapToSitemapData(result, '/');

      expect(sitemapData.pages[0].source).toBe('sitemap');
    });

    it('uses "crawl" source when no sitemap found', () => {
      const result = createMockCrawlResult({
        structure: { sitemap: null, hierarchy: {} },
      });
      const sitemapData = adapter.mapToSitemapData(result, '/');

      expect(sitemapData.pages[0].source).toBe('crawl');
    });

    it('detects blog pages', () => {
      const result = createMockCrawlResult({
        pages: [
          createMockPage({ url: 'https://example.com/' }),
          createMockPage({ url: 'https://example.com/blog/my-post' }),
          createMockPage({ url: 'https://example.com/articles/news' }),
        ],
      });
      const sitemapData = adapter.mapToSitemapData(result, '/');

      expect(sitemapData.pages[0].isBlog).toBe(false);
      expect(sitemapData.pages[1].isBlog).toBe(true);
      expect(sitemapData.pages[2].isBlog).toBe(true);
    });

    it('handles sub-path slug generation', () => {
      const result = createMockCrawlResult({
        pages: [
          createMockPage({ url: 'https://example.com/store' }),
          createMockPage({ url: 'https://example.com/store/products' }),
        ],
      });
      const sitemapData = adapter.mapToSitemapData(result, '/store');

      expect(sitemapData.pages[0].slug).toBe('homepage');
      expect(sitemapData.pages[1].slug).toBe('products');
    });
  });

  describe('mapToExtractedAssets', () => {
    it('maps atlas asset types to pipeline types', () => {
      const result = createMockCrawlResult();
      const assets = adapter.mapToExtractedAssets(result);

      const image = assets.find(a => a.url === 'https://example.com/hero.jpg');
      expect(image?.type).toBe('image');

      const icon = assets.find(a => a.url === 'https://example.com/logo.png');
      expect(icon?.type).toBe('icon');

      const font = assets.find(a => a.url === 'https://example.com/font.woff2');
      expect(font?.type).toBe('font');
    });

    it('skips css and script assets', () => {
      const result = createMockCrawlResult({
        assets: [
          { url: 'https://example.com/style.css', type: 'css', referencedBy: ['https://example.com/'] },
          { url: 'https://example.com/app.js', type: 'script', referencedBy: ['https://example.com/'] },
          { url: 'https://example.com/hero.jpg', type: 'image', referencedBy: ['https://example.com/'] },
        ],
      });
      const assets = adapter.mapToExtractedAssets(result);

      expect(assets).toHaveLength(1);
      expect(assets[0].url).toBe('https://example.com/hero.jpg');
    });

    it('expands assets into one entry per referrer when shared across pages', () => {
      // Atlas's referencedBy lists every page that references an asset (e.g.,
      // a brand logo appears on every page of the site). The previous adapter
      // took only referencedBy[0] and dropped the rest, causing the logo to
      // be attributed to a single arbitrary page (whichever Atlas crawled
      // first), which then made the homepage asset filter exclude it.
      const result = createMockCrawlResult({
        assets: [
          {
            url: 'https://example.com/wp-content/logo.png',
            type: 'image',
            referencedBy: [
              'https://example.com/reservations/',
              'https://example.com/about/',
              'https://example.com/',
            ],
          },
        ],
      });

      const assets = adapter.mapToExtractedAssets(result);

      const sources = assets
        .filter(a => a.url === 'https://example.com/wp-content/logo.png')
        .map(a => a.sourceUrl)
        .sort();

      expect(sources).toEqual([
        'https://example.com/',
        'https://example.com/about/',
        'https://example.com/reservations/',
      ]);
    });

    it('falls back to baseUrl when referencedBy is empty', () => {
      const result = createMockCrawlResult({
        assets: [
          {
            url: 'https://example.com/orphan.jpg',
            type: 'image',
            referencedBy: [],
          },
        ],
      });

      const assets = adapter.mapToExtractedAssets(result);
      const orphan = assets.find(a => a.url === 'https://example.com/orphan.jpg');

      expect(orphan).toBeDefined();
      expect(orphan?.sourceUrl).toBe('https://example.com');
    });

    it('enriches with alt text from images data', () => {
      const result = createMockCrawlResult({
        assets: [
          { url: 'https://example.com/hero.jpg', type: 'image', referencedBy: ['https://example.com/'] },
        ],
        images: [
          {
            url: 'https://example.com/hero.jpg',
            alt: 'A beautiful hero image',
            sourceUrl: 'https://example.com/',
            element: 'main',
            inHeader: false,
            inFooter: false,
            inFirstSection: true,
            nearH1: true,
            isFirstInContainer: true,
          },
        ],
      });
      const assets = adapter.mapToExtractedAssets(result);

      expect(assets[0].altText).toBe('A beautiful hero image');
    });
  });

  describe('mapDesignTokensToMetadata', () => {
    it('extracts color palette from design tokens', () => {
      const result = createMockCrawlResult({
        visual: {
          designTokens: {
            colors: [
              { value: '#2563eb', property: 'backgroundColor', elements: ['header'], frequency: 15 },
              { value: '#1e40af', property: 'backgroundColor', elements: ['button'], frequency: 10 },
              { value: '#334155', property: 'color', elements: ['p'], frequency: 20 },
            ],
            typography: [],
            spacing: [],
            borders: { radius: [] },
            shadows: [],
          },
        },
      });
      const metadata = adapter.mapDesignTokensToMetadata(result);

      expect(metadata.colorPalette).toBeDefined();
      expect(metadata.colorPalette!.primary).toContain('#2563eb');
      expect(metadata.colorPalette!.primary).toContain('#1e40af');
    });

    it('extracts typography grouped by role', () => {
      const result = createMockCrawlResult({
        visual: {
          designTokens: {
            colors: [],
            typography: [
              { fontFamily: '"Inter", sans-serif', fontSize: '32px', fontWeight: '700', lineHeight: '1.2', letterSpacing: '0', elements: ['h1'], role: 'heading' },
              { fontFamily: '"Open Sans", sans-serif', fontSize: '16px', fontWeight: '400', lineHeight: '1.5', letterSpacing: '0', elements: ['p'], role: 'body' },
            ],
            spacing: [],
            borders: { radius: [] },
            shadows: [],
          },
        },
      });
      const metadata = adapter.mapDesignTokensToMetadata(result);

      expect(metadata.typography!.headingFonts).toEqual(['Inter']);
      expect(metadata.typography!.bodyFonts).toEqual(['Open Sans']);
    });

    it('returns empty partial when no visual data', () => {
      const result = createMockCrawlResult({ visual: undefined });
      const metadata = adapter.mapDesignTokensToMetadata(result);

      expect(metadata).toEqual({});
    });
  });

  describe('mapNavigation', () => {
    it('uses primary navigation when available', () => {
      const result = createMockCrawlResult({
        navigation: {
          primary: [
            { text: 'Home', url: '/' },
            { text: 'About', url: '/about' },
            { text: 'Contact', url: '/contact' },
          ],
        },
      });
      const nav = adapter.mapNavigation(result);

      expect(nav).toHaveLength(3);
      expect(nav[0]).toEqual({ label: 'Home', url: '/', isExternal: false });
      expect(nav[1]).toEqual({ label: 'About', url: '/about', isExternal: false });
    });

    it('falls back to homepage links when no navigation', () => {
      const result = createMockCrawlResult({
        navigation: undefined,
        pages: [
          createMockPage({
            url: 'https://example.com/',
            links: [
              { url: 'https://example.com/about', text: 'About Us', isInternal: true },
              { url: 'https://example.com/services', text: 'Services', isInternal: true },
              { url: 'https://external.com', text: 'Partner', isInternal: false },
            ],
          }),
        ],
      });
      const nav = adapter.mapNavigation(result);

      expect(nav).toHaveLength(2);
      expect(nav[0]).toEqual({ label: 'About Us', url: '/about', isExternal: false });
      expect(nav[1]).toEqual({ label: 'Services', url: '/services', isExternal: false });
    });

    it('normalizes same-origin absolute URLs to path-only', () => {
      const result = createMockCrawlResult({
        navigation: {
          primary: [
            { text: 'HOME', url: 'https://example.com/home' },
            { text: 'ABOUT', url: 'https://example.com/about/' },
          ],
        },
      });
      const nav = adapter.mapNavigation(result);

      expect(nav).toHaveLength(2);
      expect(nav[0]).toEqual({ label: 'HOME', url: '/home', isExternal: false });
      // Trailing slash is stripped on same-origin paths
      expect(nav[1]).toEqual({ label: 'ABOUT', url: '/about', isExternal: false });
    });

    it('skips mailto:, tel:, and javascript: nav URLs', () => {
      const result = createMockCrawlResult({
        navigation: {
          primary: [
            { text: 'Contact us', url: 'mailto:hi@example.com' },
            { text: 'Call', url: 'tel:5551234' },
            { text: 'Home', url: '/home' },
          ],
        },
      });
      const nav = adapter.mapNavigation(result);

      expect(nav).toHaveLength(1);
      expect(nav[0].url).toBe('/home');
    });

    it('skips mailto:, tel:, javascript:, hashes in homepage-link fallback', () => {
      // Atlas may classify these as isInternal=true on hostnames it owns; the
      // fallback path now filters them out for parity with the primary path.
      const result = createMockCrawlResult({
        navigation: undefined,
        pages: [
          createMockPage({
            url: 'https://example.com/',
            links: [
              { url: 'mailto:hi@example.com', text: 'Contact us', isInternal: true },
              { url: 'tel:5551234', text: 'Call', isInternal: true },
              // eslint-disable-next-line no-script-url
              { url: 'javascript:void(0)', text: 'Toggle', isInternal: true },
              { url: '#section', text: 'Anchor', isInternal: true },
              { url: 'https://example.com/about', text: 'About', isInternal: true },
            ],
          }),
        ],
      });

      const nav = adapter.mapNavigation(result);

      expect(nav).toHaveLength(1);
      expect(nav[0]).toEqual({ label: 'About', url: '/about', isExternal: false });
    });
  });

  describe('mapFooterNavigation', () => {
    it('returns footer nav with same normalization as primary', () => {
      const result = createMockCrawlResult({
        navigation: {
          primary: [{ text: 'Home', url: '/' }],
          footer: [
            { text: 'Privacy', url: 'https://example.com/privacy' },
            { text: 'External Partner', url: 'https://partner.com/info' },
          ],
        },
      });
      const footer = adapter.mapFooterNavigation(result);

      expect(footer).toHaveLength(2);
      expect(footer[0]).toEqual({ label: 'Privacy', url: '/privacy', isExternal: false });
      expect(footer[1]).toEqual({ label: 'External Partner', url: 'https://partner.com/info', isExternal: true });
    });

    it('returns empty array when no footer nav', () => {
      const result = createMockCrawlResult({ navigation: { primary: [] } });
      expect(adapter.mapFooterNavigation(result)).toEqual([]);
    });
  });

  describe('mapContact', () => {
    it('passes through phones, emails, addresses, hours, social', () => {
      const result = createMockCrawlResult({
        contact: {
          phones: [{ number: '8019029971' }],
          emails: [{ address: 'hi@example.com' }],
          addresses: [{ formatted: '123 Main St', street: '123 Main St', city: 'Midvale', state: 'UT', zip: '84047', country: 'United States' }],
          hours: [{ day: 'Monday', open: '10:00', close: '21:00' }],
          social: [
            { platform: 'facebook', url: 'https://www.facebook.com/example' },
            { platform: 'instagram', url: 'https://www.instagram.com/example' },
          ],
        },
      });
      const contact = adapter.mapContact(result);

      expect(contact?.phones).toEqual([{ number: '8019029971', type: undefined }]);
      expect(contact?.emails?.[0].address).toBe('hi@example.com');
      expect(contact?.addresses?.[0].city).toBe('Midvale');
      expect(contact?.hours?.[0]).toEqual({ day: 'Monday', open: '10:00', close: '21:00' });
      expect(contact?.social).toHaveLength(2);
    });

    it('returns undefined when contact section is absent', () => {
      const result = createMockCrawlResult({ contact: undefined });
      expect(adapter.mapContact(result)).toBeUndefined();
    });

    it('dedupes social by URL', () => {
      const result = createMockCrawlResult({
        contact: {
          social: [
            { platform: 'facebook', url: 'https://www.facebook.com/example' },
            { platform: 'facebook', url: 'https://www.facebook.com/example' },
          ],
        },
      });
      expect(adapter.mapContact(result)?.social).toHaveLength(1);
    });
  });

});
