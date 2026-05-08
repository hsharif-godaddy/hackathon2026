import { mkdir } from 'node:fs/promises';

import type { BrowserContext, Page } from 'playwright';

import { dismissCookieConsent } from './cookie-dismiss.js';
import { captureRenderedSignals, isRouteEmpty } from './render-check.js';
import { discoverRoutes } from './routes.js';
import { captureTiles, slugifyPath, type CaptureTilesResult } from './tiles.js';
import {
  VIEWPORTS,
  VIEWPORT_ORDER,
  type CapturedSite,
  type DiscoveredRoute,
  type RenderedSignals,
  type RouteCapture,
  type Tile,
  type Viewport,
  type ViewportName,
} from './types.js';

const PAGE_GOTO_TIMEOUT_MS = 30_000;
const APP_READY_SELECTOR = '#app > *';
const APP_READY_TIMEOUT_MS = 15_000;

export interface CaptureRoutesOptions {
  previewUrl: string;
  /**
   * Existing playwright context owned by the caller. captureRoutes
   * neither launches nor closes the browser/context; it only opens
   * and closes its own pages.
   */
  context: BrowserContext;
  /**
   * Page already navigated to previewUrl with the cookie banner
   * dismissed. captureRoutes uses this for href discovery instead
   * of re-navigating, which avoids the dev-server `networkidle`
   * timeout trap and saves ~1 navigation per trial. Caller owns
   * the lifecycle of this page.
   */
  homepagePage: Page;
  /** Directory where per-route per-viewport tiles are written. */
  outputDir: string;
  ignoreHttpsErrors?: boolean;
  maxRoutes?: number;
}

interface ViewportResult {
  tiles: Tile[];
  rendered?: RenderedSignals;
  captureError?: string;
}

async function captureOneViewport(params: {
  context: BrowserContext;
  route: DiscoveredRoute;
  viewport: Viewport;
  outDir: string;
  routeSlug: string;
  collectRendered: boolean;
  skip: boolean;
}): Promise<ViewportResult> {
  const {
    context,
    route,
    viewport,
    outDir,
    routeSlug,
    collectRendered,
    skip,
  } = params;

  if (skip) {
    return { tiles: [] };
  }

  const page: Page = await context.newPage();
  try {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    // domcontentloaded + explicit app-ready selector beats networkidle
    // for dev servers (HMR / WebSockets keep the network busy forever).
    await page.goto(route.url, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_GOTO_TIMEOUT_MS,
    });
    await page
      .waitForSelector(APP_READY_SELECTOR, {
        timeout: APP_READY_TIMEOUT_MS,
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Timeout') && !msg.includes('waiting for')) {
          throw err;
        }
      });
    await dismissCookieConsent(page);

    const rendered = collectRendered
      ? await captureRenderedSignals(page)
      : undefined;

    if (rendered && isRouteEmpty(rendered)) {
      return { tiles: [], rendered };
    }

    const result: CaptureTilesResult = await captureTiles({
      page,
      viewport,
      outDir,
      routeSlug,
    });
    return { tiles: result.tiles, rendered, captureError: result.captureError };
  } finally {
    await page.close().catch((err: unknown) => {
      console.warn('captureOneViewport: page.close() failed', err);
    });
  }
}

export async function captureRoutes(
  options: CaptureRoutesOptions,
): Promise<CapturedSite> {
  const startedAt = Date.now();
  const errors: string[] = [];

  await mkdir(options.outputDir, { recursive: true });

  const { context, homepagePage } = options;
  let routes: DiscoveredRoute[] = [];
  const perRoute: RouteCapture[] = [];

  // Reuse the page the caller already navigated and post-processed
  // (cookie banner dismissed, app-ready). Avoids a redundant goto
  // that previously timed out under `networkidle` against dev servers.
  try {
    routes = await discoverRoutes({
      previewUrl: options.previewUrl,
      page: homepagePage,
      ignoreHttpsErrors: options.ignoreHttpsErrors,
      maxRoutes: options.maxRoutes,
    });
  } catch (err) {
    const msg = `route discovery failed: ${err instanceof Error ? err.message : 'unknown'}`;
    console.warn('[captureRoutes]', msg);
    errors.push(msg);
  }

  const reachable = routes.filter(
    (r) => r.status === 'ok' || r.status === 'redirect',
  );

  for (const route of reachable) {
    const routeSlug = slugifyPath(route.path);
    const perViewport: Partial<Record<ViewportName, { tiles: Tile[] }>> = {};
    let renderedForRoute: RenderedSignals | undefined;
    let skipRemaining = false;

    for (let vi = 0; vi < VIEWPORT_ORDER.length; vi++) {
      const vpName = VIEWPORT_ORDER[vi];
      const vp = VIEWPORTS[vpName];
      try {
        const result = await captureOneViewport({
          context,
          route,
          viewport: vp,
          outDir: options.outputDir,
          routeSlug,
          collectRendered: vi === 0,
          skip: skipRemaining,
        });
        perViewport[vpName] = { tiles: result.tiles };
        if (result.captureError) {
          errors.push(`${route.path} @ ${vpName}: ${result.captureError}`);
        }
        if (result.rendered) {
          renderedForRoute = result.rendered;
          if (isRouteEmpty(result.rendered)) {
            route.isRouteEmpty = true;
            skipRemaining = true;
          }
        }
      } catch (err) {
        errors.push(
          `${route.path} @ ${vpName}: ` +
            (err instanceof Error ? err.message : 'unknown'),
        );
        perViewport[vpName] = { tiles: [] };
      }
    }

    perRoute.push({
      route,
      rendered: renderedForRoute,
      perViewport: perViewport as Record<ViewportName, { tiles: Tile[] }>,
    });
  }

  return {
    previewUrl: options.previewUrl,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    outputDir: options.outputDir,
    routes,
    perRoute,
    errors,
  };
}
