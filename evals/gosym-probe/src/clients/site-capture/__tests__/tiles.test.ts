import { describe, it, expect, vi, beforeEach } from 'vitest';

import { slugifyPath, captureTiles, settleForScreenshot } from '../tiles.js';
import type { Viewport } from '../types.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

const VIEWPORT: Viewport = { name: 'mobile', width: 375, height: 667 };

interface ScrollMetricsStub {
  scrollY: number;
  innerHeight: number;
  scrollHeight: number;
}

function makePage(overrides: {
  evaluateResults?: unknown[];
  screenshotFn?: () => Promise<Buffer>;
  scrollMetrics?: ScrollMetricsStub;
  // Per-call errors: index 0 = images waitForFunction, index 1 = quiescence waitForFunction.
  // Pass a single value to apply to all calls (backward compat).
  waitForFunctionError?: unknown | unknown[];
  waitForLoadStateError?: unknown;
} = {}) {
  const {
    scrollMetrics = { scrollY: 0, innerHeight: 667, scrollHeight: 667 },
    screenshotFn = async () => Buffer.from(''),
    waitForLoadStateError,
  } = overrides;

  const wffErrors = Array.isArray(overrides.waitForFunctionError)
    ? overrides.waitForFunctionError
    : overrides.waitForFunctionError !== undefined
      ? [overrides.waitForFunctionError, overrides.waitForFunctionError]
      : [];

  let evaluateCallIndex = 0;
  let waitForFunctionCallIndex = 0;
  const evaluateResults = overrides.evaluateResults;

  return {
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async () => {
      if (evaluateResults) {
        return evaluateResults[evaluateCallIndex++];
      }
      return scrollMetrics;
    }),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockImplementation(screenshotFn),
    waitForFunction: vi.fn().mockImplementation(async () => {
      const err = wffErrors[waitForFunctionCallIndex++];
      if (err !== undefined) throw err;
    }),
    waitForLoadState: vi.fn().mockImplementation(async () => {
      if (waitForLoadStateError !== undefined) throw waitForLoadStateError;
    }),
  };
}

// ── slugifyPath ───────────────────────────────────────────────────────────────

describe('util/tiles', () => {
  describe('slugifyPath', () => {
    it('maps root path to home', () => {
      expect(slugifyPath('/')).toBe('home');
    });

    it('strips leading slash and lowercases punctuation to dashes', () => {
      expect(slugifyPath('/about')).toBe('about');
      expect(slugifyPath('/contact-us')).toBe('contact-us');
      expect(slugifyPath('/blog/post-1')).toBe('blog-post-1');
    });

    it('collapses runs of non-alphanumerics into a single dash', () => {
      expect(slugifyPath('/a//b///c')).toBe('a-b-c');
      expect(slugifyPath('/foo.bar_baz')).toBe('foo-bar-baz');
    });

    it('trims leading and trailing dashes from the slug', () => {
      expect(slugifyPath('/-weird-')).toBe('weird');
      expect(slugifyPath('/___')).toBe('home');
    });
  });

  // ── captureTiles ────────────────────────────────────────────────────────────

  describe('captureTiles', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns tiles for each captured screenshot', async () => {
      const page = makePage({
        scrollMetrics: { scrollY: 0, innerHeight: 100, scrollHeight: 300 },
      });
      const result = await captureTiles({
        page: page as never,
        viewport: VIEWPORT,
        outDir: '/tmp/out',
        routeSlug: 'home',
      });

      expect(result.captureError).toBeUndefined();
      expect(result.tiles.length).toBeGreaterThan(0);
      expect(result.tiles[0]).toMatchObject({ index: 0, yOffset: 0 });
    });

    it('stops when atBottom is true and returns tiles up to that point', async () => {
      // scrollHeight === innerHeight: atBottom is true on i=1. The screenshot
      // at i=1 is still taken (break fires after push), so 2 tiles total.
      const page = makePage({
        scrollMetrics: { scrollY: 0, innerHeight: 667, scrollHeight: 667 },
      });
      const result = await captureTiles({
        page: page as never,
        viewport: VIEWPORT,
        outDir: '/tmp/out',
        routeSlug: 'home',
      });

      expect(result.captureError).toBeUndefined();
      expect(result.tiles).toHaveLength(2);
    });

    it('never exceeds MAX_TILES (6) tiles', async () => {
      // Large page that never reaches bottom
      const page = makePage({
        scrollMetrics: {
          scrollY: 0,
          innerHeight: 100,
          scrollHeight: 999_999,
        },
      });
      const result = await captureTiles({
        page: page as never,
        viewport: VIEWPORT,
        outDir: '/tmp/out',
        routeSlug: 'home',
      });

      expect(result.tiles.length).toBeLessThanOrEqual(6);
    });

    it('returns tiles captured so far with captureError on screenshot failure', async () => {
      let screenshotCallCount = 0;
      const page = makePage({
        scrollMetrics: { scrollY: 0, innerHeight: 100, scrollHeight: 999 },
        screenshotFn: async () => {
          screenshotCallCount++;
          if (screenshotCallCount === 2) {
            throw new Error('Target closed');
          }
          return Buffer.from('');
        },
      });

      const result = await captureTiles({
        page: page as never,
        viewport: VIEWPORT,
        outDir: '/tmp/out',
        routeSlug: 'home',
      });

      expect(result.tiles).toHaveLength(1);
      expect(result.captureError).toMatch(/screenshot failed at tile 1/);
    });

    it('returns captureError (not raw throw) when scrollTo/readMetrics fails mid-loop', async () => {
      let evaluateCallCount = 0;
      const page = makePage({
        scrollMetrics: { scrollY: 0, innerHeight: 100, scrollHeight: 999 },
      });
      // Override evaluate to throw on the second tile's scrollTo call
      // (calls per tile: scrollTo, readMetrics = 2 calls per tile)
      page.evaluate = vi.fn().mockImplementation(async () => {
        evaluateCallCount++;
        // settle loop + reset scroll = several calls; then 2 per tile in captureTiles
        // Just throw on the 3rd captureTiles-level evaluate (tile 1 scrollTo)
        if (evaluateCallCount === 3) throw new Error('context destroyed');
        return { scrollY: 0, innerHeight: 100, scrollHeight: 999 };
      });

      // Should not throw — must return { tiles, captureError }
      const result = await captureTiles({
        page: page as never,
        viewport: VIEWPORT,
        outDir: '/tmp/out',
        routeSlug: 'home',
      });

      expect(result.captureError).toBeDefined();
    });
  });

  // ── settleForScreenshot ─────────────────────────────────────────────────────

  describe('settleForScreenshot', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('resolves without error when all calls succeed', async () => {
      const page = makePage();
      await expect(settleForScreenshot(page as never)).resolves.toBeUndefined();
    });

    it('swallows waitForFunction Timeout errors', async () => {
      const page = makePage({
        waitForFunctionError: new Error('Timeout exceeded waiting for function'),
      });
      await expect(settleForScreenshot(page as never)).resolves.toBeUndefined();
    });

    it('warns on waitForFunction non-Error rejections', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const page = makePage({ waitForFunctionError: 'string-rejection' });

      await settleForScreenshot(page as never);

      expect(warnSpy).toHaveBeenCalledWith(
        '[settle] waitForFunction non-Error rejection:',
        'string-rejection',
      );
      warnSpy.mockRestore();
    });

    it('swallows waitForLoadState Timeout errors', async () => {
      const page = makePage({
        waitForLoadStateError: new Error('Timeout waiting for load state'),
      });
      await expect(settleForScreenshot(page as never)).resolves.toBeUndefined();
    });

    it('warns on waitForLoadState non-Error rejections', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const page = makePage({ waitForLoadStateError: 42 });

      await settleForScreenshot(page as never);

      expect(warnSpy).toHaveBeenCalledWith(
        '[settle] waitForLoadState non-Error rejection:',
        42,
      );
      warnSpy.mockRestore();
    });

    it('calls waitForFunction twice: once for images, once for quiescence', async () => {
      const page = makePage();

      await settleForScreenshot(page as never);

      expect(page.waitForFunction).toHaveBeenCalledTimes(2);
    });

    it('resolves when quiescence waitForFunction times out (cap path)', async () => {
      // Images call succeeds; quiescence call times out — settle must still resolve.
      const page = makePage({
        waitForFunctionError: [undefined, new Error('Timeout 3000ms exceeded')],
      });

      await expect(settleForScreenshot(page as never)).resolves.toBeUndefined();
    });

    it('does not call waitForTimeout for the post-settle wait', async () => {
      const page = makePage();

      await settleForScreenshot(page as never);

      // waitForTimeout is only used in the scroll-step loop, not as a post-settle sleep.
      const calls: string[] = (page.waitForTimeout as ReturnType<typeof vi.fn>).mock.calls
        .map((args: unknown[]) => String(args[0]));
      expect(calls.every((ms) => ms !== '3000')).toBe(true);
    });
  });
});
