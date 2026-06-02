import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const {
  mockPage,
  mockContext,
  mockBrowser,
  mockCaptureRoutes,
  mockDismissCookieConsent,
  cookieClickedAt,
  screenshotCalledAt,
  callOrder,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  const cookieClickedAt: { value: number | null } = { value: null };
  const screenshotCalledAt: { value: number | null } = { value: null };
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue('<html><body>app</body></html>'),
    screenshot: vi.fn().mockImplementation(async function () {
      screenshotCalledAt.value = callOrder.length;
      callOrder.push('screenshot');
      return Buffer.from('PNGDATA');
    }),
    url: vi.fn().mockReturnValue('https://preview.local:5001'),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockPage,
    mockContext,
    mockBrowser,
    mockCaptureRoutes: vi.fn().mockResolvedValue({
      previewUrl: 'https://preview.local:5001',
      generatedAt: new Date().toISOString(),
      durationMs: 100,
      outputDir: '/tmp/capture',
      routes: [],
      perRoute: [],
      errors: [],
    }),
    mockDismissCookieConsent: vi.fn().mockImplementation(async function () {
      cookieClickedAt.value = callOrder.length;
      callOrder.push('cookie');
    }),
    cookieClickedAt,
    screenshotCalledAt,
    callOrder,
  };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

vi.mock('../site-capture/capture.js', () => ({
  captureRoutes: mockCaptureRoutes,
}));

vi.mock('../site-capture/cookie-dismiss.js', () => ({
  dismissCookieConsent: mockDismissCookieConsent,
}));

import {
  AABPreviewUrlResolver,
  SetupContextResolver,
  SiteCapture,
} from '../dom-capture.js';
import type { PreviewUrlResolver } from '../dom-capture.js';

const PREVIEW_URL = 'https://preview.local:5001';

function makeResolver(url = PREVIEW_URL): PreviewUrlResolver {
  return { resolve: vi.fn().mockResolvedValue(url) };
}

describe('SiteCapture', () => {
  let trialDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    callOrder.length = 0;
    cookieClickedAt.value = null;
    screenshotCalledAt.value = null;
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.waitForSelector.mockResolvedValue(undefined);
    mockPage.content.mockResolvedValue('<html><body>app</body></html>');
    mockPage.url.mockReturnValue(PREVIEW_URL);
    mockContext.newPage.mockResolvedValue(mockPage);
    mockBrowser.newContext.mockResolvedValue(mockContext);
    trialDir = await mkdtemp(join(tmpdir(), 'site-capture-test-'));
  });

  afterEach(async () => {
    await rm(trialDir, { recursive: true, force: true });
  });

  it('writes 0.png to <trialDir>/snapshots/', async () => {
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    const result = await cap.capture({}, trialDir);

    const expectedPath = join(trialDir, 'snapshots', '0.png');
    expect(result.snapshot.screenshotPath).toBe(expectedPath);
    const bytes = await readFile(expectedPath);
    expect(bytes.toString()).toBe('PNGDATA');
  });

  it('writes 0.html to <trialDir>/snapshots/', async () => {
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    const result = await cap.capture({}, trialDir);

    const expectedPath = join(trialDir, 'snapshots', '0.html');
    expect(result.snapshot.htmlPath).toBe(expectedPath);
    const html = await readFile(expectedPath, 'utf-8');
    expect(html).toBe('<html><body>app</body></html>');
  });

  it('dismisses the cookie banner before taking the screenshot', async () => {
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    await cap.capture({}, trialDir);

    expect(mockDismissCookieConsent).toHaveBeenCalled();
    expect(mockPage.screenshot).toHaveBeenCalled();
    expect(cookieClickedAt.value).not.toBeNull();
    expect(screenshotCalledAt.value).not.toBeNull();
    expect(cookieClickedAt.value as number).toBeLessThan(
      screenshotCalledAt.value as number,
    );
  });

  it(
    'invokes captureRoutes with the existing context and ' +
      'snapshots output dir',
    async () => {
      const cap = new SiteCapture({
        resolver: makeResolver(),
        ignoreHttpsErrors: true,
      });

      const result = await cap.capture({}, trialDir);

      expect(mockCaptureRoutes).toHaveBeenCalledWith({
        previewUrl: PREVIEW_URL,
        context: mockContext,
        homepagePage: mockPage,
        outputDir: join(trialDir, 'snapshots'),
        ignoreHttpsErrors: true,
        maxRoutes: undefined,
      });
      expect(result.capturedSite).toBeDefined();
    },
  );

  it('returns DOMSnapshot metadata (not raw bytes)', async () => {
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    const result = await cap.capture({}, trialDir);

    expect(result.snapshot).toMatchObject({
      url: PREVIEW_URL,
      screenshotPath: join(trialDir, 'snapshots', '0.png'),
      htmlPath: join(trialDir, 'snapshots', '0.html'),
      consoleLogs: [],
    });
    expect(typeof result.snapshot.timestamp).toBe('string');
  });

  it(
    'closes browser and context even when captureRoutes throws',
    async () => {
      mockCaptureRoutes.mockRejectedValueOnce(new Error('discovery failed'));
      const cap = new SiteCapture({
        resolver: makeResolver(),
        ignoreHttpsErrors: true,
      });

      await expect(cap.capture({}, trialDir)).rejects.toThrow(
        'discovery failed',
      );
      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    },
  );

  it(
    'keeps the homepage page open during captureRoutes, then closes it',
    async () => {
      let pageOpenAtCaptureRoutes = false;
      mockCaptureRoutes.mockImplementationOnce(async function () {
        pageOpenAtCaptureRoutes = !mockPage.close.mock.calls.length;
        return {
          previewUrl: PREVIEW_URL,
          generatedAt: new Date().toISOString(),
          durationMs: 1,
          outputDir: '/tmp',
          routes: [],
          perRoute: [],
          errors: [],
        };
      });
      const cap = new SiteCapture({
        resolver: makeResolver(),
        ignoreHttpsErrors: true,
      });

      await cap.capture({}, trialDir);

      expect(pageOpenAtCaptureRoutes).toBe(true);
      expect(mockPage.close).toHaveBeenCalled();
    },
  );

  it('closes the homepage page when navigation fails', async () => {
    mockPage.waitForSelector.mockRejectedValueOnce(new Error('not ready'));
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    await expect(cap.capture({}, trialDir)).rejects.toThrow('not ready');
    expect(mockPage.close).toHaveBeenCalled();
  });

  it('uses domcontentloaded wait strategy on homepage navigation', async () => {
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    await cap.capture({}, trialDir);

    expect(mockPage.goto).toHaveBeenCalledWith(
      PREVIEW_URL,
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
  });
});

describe('AABPreviewUrlResolver (re-exported)', () => {
  it('exists as a named export from dom-capture', () => {
    expect(AABPreviewUrlResolver).toBeDefined();
  });
});

describe('SetupContextResolver', () => {
  it('returns previewUrl from SetupContext', async () => {
    const r = new SetupContextResolver();
    const url = await r.resolve({ previewUrl: 'http://localhost:5100' });
    expect(url).toBe('http://localhost:5100');
  });

  it('throws when previewUrl is missing from SetupContext', async () => {
    const r = new SetupContextResolver();
    await expect(r.resolve({})).rejects.toThrow(/missing previewUrl/i);
  });
});
