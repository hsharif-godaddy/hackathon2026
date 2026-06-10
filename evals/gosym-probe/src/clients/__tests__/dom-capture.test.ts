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
  pageHandlers,
  firePageEvent,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  const cookieClickedAt: { value: number | null } = { value: null };
  const screenshotCalledAt: { value: number | null } = { value: null };
  // Captures listeners registered via page.on(event, handler) so tests can
  // synthesize Playwright events (response, pageerror, ...).
  const pageHandlers: Map<string, ((arg: unknown) => void)[]> = new Map();
  const firePageEvent = (event: string, arg: unknown): void => {
    for (const handler of pageHandlers.get(event) ?? []) handler(arg);
  };
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue('<html><body>app</body></html>'),
    title: vi.fn().mockResolvedValue('App'),
    evaluate: vi.fn().mockResolvedValue(''),
    screenshot: vi.fn().mockImplementation(async function () {
      screenshotCalledAt.value = callOrder.length;
      callOrder.push('screenshot');
      return Buffer.from('PNGDATA');
    }),
    url: vi.fn().mockReturnValue('https://preview.local:5001'),
    on: vi.fn().mockImplementation((event: string, handler: (arg: unknown) => void) => {
      const list = pageHandlers.get(event) ?? [];
      list.push(handler);
      pageHandlers.set(event, list);
    }),
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
    pageHandlers,
    firePageEvent,
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

// Make readiness-retry backoff instant so retry tests don't sleep for real.
vi.mock('../../util/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import {
  AABPreviewUrlResolver,
  CaptureError,
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
    pageHandlers.clear();
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.waitForSelector.mockResolvedValue(undefined);
    mockPage.content.mockResolvedValue('<html><body>app</body></html>');
    mockPage.title.mockResolvedValue('App');
    mockPage.evaluate.mockResolvedValue('');
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
    // Healthy-but-never-painted app: selector never appears (probe + long wait
    // both reject), no 5xx → falls through to the long wait, which throws.
    mockPage.waitForSelector.mockRejectedValue(new Error('not ready'));
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    await expect(cap.capture({}, trialDir)).rejects.toThrow(CaptureError);
    expect(mockPage.close).toHaveBeenCalled();
  });

  it('wraps a selector timeout in a CaptureError carrying diagnostics', async () => {
    mockPage.waitForSelector.mockRejectedValue(
      new Error('Timeout 90000ms exceeded'),
    );
    mockPage.title.mockResolvedValue('500 Internal Server Error');
    mockPage.evaluate.mockResolvedValue('Rate limit exceeded. Please retry.');
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    const err = await cap.capture({}, trialDir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CaptureError);
    const captureErr = err as CaptureError;
    expect(captureErr.diagnostics.pageTitle).toBe('500 Internal Server Error');
    expect(captureErr.diagnostics.bodyTextSnippet).toContain('Rate limit');
    expect(captureErr.message).toContain('500 Internal Server Error');
    expect(captureErr.cause).toBeInstanceOf(Error);
  });

  it('flags a 429 response observed during capture as rate-limited', async () => {
    // Fire a 429 response event once the listeners are wired, then never paint
    // the selector so capture takes the failure path. 429 is not a 5xx, so it
    // is not retried — it falls through to the long wait.
    mockPage.goto.mockImplementation(async () => {
      firePageEvent('response', {
        ok: () => false,
        status: () => 429,
        url: () => `${PREVIEW_URL}/api/generate`,
        headers: () => ({ 'retry-after': '30' }),
      });
      return { status: () => 200 };
    });
    mockPage.waitForSelector.mockRejectedValue(
      new Error('Timeout 90000ms exceeded'),
    );
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    const err = await cap.capture({}, trialDir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CaptureError);
    const captureErr = err as CaptureError;
    const failures = captureErr.diagnostics.networkFailures;
    expect(failures.some((f: { isRateLimit: boolean }) => f.isRateLimit)).toBe(
      true,
    );
    expect(captureErr.message).toContain('rate-limit');
  });

  it('writes failure artifacts (screenshot, html, diagnostics) on timeout', async () => {
    mockPage.waitForSelector.mockRejectedValue(
      new Error('Timeout 90000ms exceeded'),
    );
    mockPage.content.mockResolvedValue('<html><body>error page</body></html>');
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    await cap.capture({}, trialDir).catch(() => undefined);

    const diag = JSON.parse(
      await readFile(join(trialDir, 'snapshots', '0-diagnostics.json'), 'utf-8'),
    );
    expect(diag).toHaveProperty('pageErrors');
    expect(diag).toHaveProperty('networkFailures');
    const html = await readFile(
      join(trialDir, 'snapshots', '0.html'),
      'utf-8',
    );
    expect(html).toContain('error page');
  });

  it('recovers when a transient 502 clears within the readiness window', async () => {
    // First boot serves a 502 + never paints; second boot is healthy.
    let attempt = 0;
    mockPage.goto.mockImplementation(async () => {
      attempt++;
      if (attempt === 1) {
        return { status: () => 502 };
      }
      return { status: () => 200 };
    });
    // Probe fails on attempt 1 (502, not painted), succeeds on attempt 2.
    mockPage.waitForSelector
      .mockRejectedValueOnce(new Error('Timeout 3000ms exceeded'))
      .mockResolvedValue(undefined);
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    const result = await cap.capture({}, trialDir);

    expect(attempt).toBeGreaterThanOrEqual(2);
    expect(result.snapshot.httpStatus).toBe(200);
  });

  it('fast-fails a persistent 502 without waiting the full ready timeout', async () => {
    // Every boot serves a 502 and never paints. With a tiny retry window the
    // loop gives up quickly via ReadinessNavigationError rather than burning
    // the 90s long wait.
    mockPage.goto.mockImplementation(async () => ({ status: () => 502 }));
    mockPage.waitForSelector.mockRejectedValue(
      new Error('Timeout 3000ms exceeded'),
    );
    mockPage.evaluate.mockResolvedValue('Service startup failed');
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
      readinessRetryWindowMs: 10,
    });

    const err = await cap.capture({}, trialDir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CaptureError);
    const captureErr = err as CaptureError;
    expect(captureErr.diagnostics.httpStatus).toBe(502);
    expect(captureErr.diagnostics.bodyTextSnippet).toContain(
      'Service startup failed',
    );
  });

  it('retries on a 5xx sub-resource (e.g. /src/main.tsx) then recovers', async () => {
    // App shell loads 200, but the entry module 500s on the first boot (the
    // persona/5 signature) — Vite mid dep-optimization. Retry clears it.
    let attempt = 0;
    mockPage.goto.mockImplementation(async () => {
      attempt++;
      if (attempt === 1) {
        firePageEvent('response', {
          ok: () => false,
          status: () => 500,
          url: () => `${PREVIEW_URL}/src/main.tsx`,
          headers: () => ({}),
        });
      }
      return { status: () => 200 };
    });
    mockPage.waitForSelector
      .mockRejectedValueOnce(new Error('Timeout 3000ms exceeded'))
      .mockResolvedValue(undefined);
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    const result = await cap.capture({}, trialDir);

    expect(attempt).toBeGreaterThanOrEqual(2);
    expect(result.snapshot.url).toBe(PREVIEW_URL);
  });

  it('records httpStatus on a successful capture', async () => {
    mockPage.goto.mockResolvedValueOnce({ status: () => 200 });
    const cap = new SiteCapture({
      resolver: makeResolver(),
      ignoreHttpsErrors: true,
    });

    const result = await cap.capture({}, trialDir);

    expect(result.snapshot.httpStatus).toBe(200);
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
