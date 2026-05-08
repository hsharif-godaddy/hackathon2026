import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Page } from 'playwright';

import type { Tile, Viewport } from './types.js';

const MAX_TILES = 6;
const SETTLE_SCROLL_STEP_PX = 800;
const SETTLE_MAX_STEPS = 60;
const SETTLE_STEP_WAIT_MS = 120;
const SETTLE_NETWORK_IDLE_TIMEOUT_MS = 5_000;
// Cap for the quiescence wait. Pages with continuous animations (carousels,
// counters) never go quiet, so we fall through to capture after this delay.
const SETTLE_QUIESCENCE_CAP_MS = 3_000;
// DOM must stay mutation-free for this long before we consider it settled.
const SETTLE_QUIESCENCE_QUIET_MS = 300;
// How often waitForFunction polls the quiescence predicate in the browser.
const SETTLE_QUIESCENCE_POLL_MS = 50;
const SCROLL_SETTLE_MS = 300;

export function slugifyPath(p: string): string {
  if (p === '/') return 'home';
  const slug = p
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug || 'home';
}

// Waits until the page DOM has been mutation-free for SETTLE_QUIESCENCE_QUIET_MS,
// or until maxMs elapses (pages with persistent animations never go fully quiet).
// A MutationObserver is installed once per page context and reused across calls.
async function waitForQuiescence(page: Page, maxMs: number): Promise<void> {
  await page
    .waitForFunction(
      (quietMs: number) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (!w.__quiescenceObserver) {
          w.__lastMutation = Date.now();
          w.__quiescenceObserver = new MutationObserver(() => {
            w.__lastMutation = Date.now();
          });
          w.__quiescenceObserver.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          return false;
        }
        return Date.now() - (w.__lastMutation ?? 0) >= quietMs;
      },
      SETTLE_QUIESCENCE_QUIET_MS,
      { timeout: maxMs, polling: SETTLE_QUIESCENCE_POLL_MS },
    )
    .catch(() => {});
}

// Scrolls top-to-bottom to trigger lazy loading, waits for images +
// networkidle, then returns to the top. We deliberately avoid the
// `clip` parameter on page.screenshot() because SPAs reflow during
// settle and stale clip rectangles produce
// "Clipped area is either empty or outside the resulting image" errors.
export async function settleForScreenshot(page: Page): Promise<void> {
  for (let i = 0; i < SETTLE_MAX_STEPS; i++) {
    const done = await page.evaluate((step: number) => {
      window.scrollBy(0, step);
      return (
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2
      );
    }, SETTLE_SCROLL_STEP_PX);
    await page.waitForTimeout(SETTLE_STEP_WAIT_MS);
    if (done) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));

  await page
    .waitForFunction(
      () => Array.from(document.images).every((i) => i.complete),
      null,
      { timeout: SETTLE_NETWORK_IDLE_TIMEOUT_MS },
    )
    .catch((e: unknown) => {
      if (e instanceof Error) {
        if (!e.message.includes('Timeout')) {
          console.warn('[settle] waitForFunction error:', e.message);
        }
      } else {
        console.warn('[settle] waitForFunction non-Error rejection:', e);
      }
    });

  await page
    .waitForLoadState('networkidle', {
      timeout: SETTLE_NETWORK_IDLE_TIMEOUT_MS,
    })
    .catch((e: unknown) => {
      if (e instanceof Error) {
        if (!e.message.includes('Timeout')) {
          console.warn('[settle] waitForLoadState error:', e.message);
        }
      } else {
        console.warn('[settle] waitForLoadState non-Error rejection:', e);
      }
    });
  await waitForQuiescence(page, SETTLE_QUIESCENCE_CAP_MS);
}

interface ScrollMetrics {
  scrollY: number;
  innerHeight: number;
  scrollHeight: number;
}

async function readMetrics(page: Page): Promise<ScrollMetrics> {
  return page.evaluate(() => ({
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
      window.innerHeight,
    ),
  }));
}

export interface CaptureTilesInput {
  page: Page;
  viewport: Viewport;
  outDir: string;
  routeSlug: string;
}

export interface CaptureTilesResult {
  tiles: Tile[];
  captureError?: string;
}

export async function captureTiles(
  input: CaptureTilesInput,
): Promise<CaptureTilesResult> {
  const { page, viewport, outDir, routeSlug } = input;

  const tileDir = path.join(outDir, viewport.name, routeSlug);
  await mkdir(tileDir, { recursive: true });

  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await settleForScreenshot(page);

  const tiles: Tile[] = [];

  for (let i = 0; i < MAX_TILES; i++) {
    const yOffset = i * viewport.height;
    try {
      await page.evaluate((y) => window.scrollTo(0, y), yOffset);
      await page.waitForTimeout(SCROLL_SETTLE_MS);
      const metrics = await readMetrics(page);

      const tilePath = path.join(tileDir, `tile${i}.png`);
      const atBottom =
        i > 0 &&
        metrics.scrollY + metrics.innerHeight >= metrics.scrollHeight - 4;

      await page.screenshot({
        path: tilePath,
        type: 'png',
        fullPage: false,
      });
      tiles.push({ index: i, path: tilePath, yOffset: metrics.scrollY });

      if (atBottom) break;
      if (i > 0 && yOffset >= metrics.scrollHeight) break;
    } catch (err) {
      const msg =
        `screenshot failed at tile ${i} for ${routeSlug}/${viewport.name}: ` +
        (err instanceof Error ? err.message : String(err));
      console.warn(`[tiles] ${msg}`);
      return { tiles, captureError: msg };
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  return { tiles };
}
