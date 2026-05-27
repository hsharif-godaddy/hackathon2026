import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RebuildOrchestrationService } from '../RebuildOrchestrationService.js';

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

  // Locks in the on-disk shape of the .source-site directory before the
  // orchestrator split moves savePage / loadSourceSiteData to a separate
  // PagePersistence service. Real fs (tmpdir) — not mocked — so any structural
  // change (paths, JSON shape, sitemap fields) trips this test.
  describe('persistence round-trip (real fs)', () => {
    let appDir: string;

    beforeEach(async () => {
      appDir = await mkdtemp(path.join(tmpdir(), 'rebuild-orch-test-'));
      await mkdir(path.join(appDir, '.source-site', 'pages'), { recursive: true });
      await mkdir(path.join(appDir, '.source-site', 'screenshots'), { recursive: true });
      await mkdir(path.join(appDir, '.source-site', 'assets'), { recursive: true });
    });

    afterEach(async () => {
      await rm(appDir, { recursive: true, force: true });
    });

    it('savePage writes pages/<slug>.json + .html + screenshots/<slug>.png at expected paths', async () => {
      const service = new RebuildOrchestrationService(appDir);

      const page = {
        url: 'https://example.com/',
        sanitizedContent: 'Welcome to Example. This is the homepage.',
        html: '<html><head><title>Example</title></head><body>Welcome</body></html>',
        screenshotBase64: 'data:image/png;base64,aGVsbG8=', // 'hello'
      };
      await (service as never as { savePage: (p: typeof page) => Promise<void> }).savePage(page);

      const pageJsonPath = path.join(appDir, '.source-site', 'pages', 'homepage.json');
      const pageHtmlPath = path.join(appDir, '.source-site', 'pages', 'homepage.html');
      const screenshotPath = path.join(appDir, '.source-site', 'screenshots', 'homepage.png');

      const pageContent = JSON.parse(await readFile(pageJsonPath, 'utf-8'));
      expect(pageContent.url).toBe('https://example.com/');
      expect(pageContent.slug).toBe('homepage');
      expect(pageContent.sanitizedContent).toBe(page.sanitizedContent);
      expect(pageContent.structure).toEqual(expect.objectContaining({
        hasHeader: true,
        hasFooter: true,
        hasSidebar: false,
        sections: [],
        navigation: expect.any(Array),
      }));

      expect(await readFile(pageHtmlPath, 'utf-8')).toBe(page.html);
      expect((await readFile(screenshotPath)).toString()).toBe('hello');
    });

    it('loadSourceSiteData round-trips a saved page when sitemap + metadata + assets exist', async () => {
      const service = new RebuildOrchestrationService(appDir);

      // Persist supporting metadata, sitemap, and an assets manifest — all
      // required by loadSourceSiteData. Match the shapes used elsewhere.
      await writeFile(
        path.join(appDir, '.source-site', 'site-metadata.json'),
        JSON.stringify({
          sourceUrl: 'https://example.com/',
          siteType: 'content',
          sitePurpose: 'Example',
          targetAudience: 'Visitors',
          brandVoice: 'Plain',
          designStyle: 'Minimal',
          colorPalette: { primary: [], secondary: [], accent: [] },
          typography: { headingFonts: [], bodyFonts: [] },
          scrapedAt: new Date().toISOString(),
          version: '1',
        }),
        'utf-8',
      );
      await writeFile(
        path.join(appDir, '.source-site', 'sitemap.json'),
        JSON.stringify({
          rootUrl: 'https://example.com/',
          pages: [
            { slug: 'homepage', url: 'https://example.com/', title: 'Example', scraped: true, isBlog: false },
          ],
          totalPages: 1,
          generatedAt: new Date().toISOString(),
        }),
        'utf-8',
      );
      await writeFile(
        path.join(appDir, '.source-site', 'assets', 'manifest.json'),
        JSON.stringify({
          assets: [],
          totalAssets: 0,
          byType: { image: 0, font: 0, icon: 0, other: 0 },
          generatedAt: new Date().toISOString(),
        }),
        'utf-8',
      );

      await (service as never as {
        savePage: (p: { url: string; sanitizedContent: string; html: string }) => Promise<void>;
      }).savePage({
        url: 'https://example.com/',
        sanitizedContent: 'Welcome to Example.',
        html: '<html><body>Welcome</body></html>',
      });

      const data = await (service as never as {
        loadSourceSiteData: () => Promise<{ pages: Record<string, { url: string; sanitizedContent: string }> }>;
      }).loadSourceSiteData();

      expect(data.pages.homepage).toBeDefined();
      expect(data.pages.homepage?.url).toBe('https://example.com/');
      expect(data.pages.homepage?.sanitizedContent).toBe('Welcome to Example.');
    });
  });
});
