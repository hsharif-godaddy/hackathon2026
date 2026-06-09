import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BrowserContext, Page } from 'playwright';

import { dismissCookieConsent } from './cookie-dismiss.js';
import { wait } from './ready.js';
import { discoverRoutes } from './routes.js';
import { captureTiles, slugifyPath } from './tiles.js';
import { VIEWPORT_ORDER, VIEWPORTS, type CapturedSite, type CaptureDebug, type ViewportName } from './types.js';

const PAGE_GOTO_TIMEOUT_MS = 30_000;
const MAX_ERROR_LINES = 30;

async function debug(page: Page, status: number | null): Promise<CaptureDebug> {
  const title = await page.title().catch(() => '');
  const stats = await page
    .evaluate(() => {
      const html = document.documentElement?.outerHTML ?? '';
      const visibleText =
        (document.body?.innerText ?? document.documentElement?.innerText ?? '')
          .replace(/\s+/g, ' ')
          .trim();
      const body = document.body;
      const htmlEl = document.documentElement;

      const style = (el: Element | null) => {
        if (!el) return {};
        const s = window.getComputedStyle(el);
        return {
          bg: s.backgroundColor,
          color: 'color' in s ? (s as unknown as { color: string }).color : undefined,
        };
      };

      const bodyStyle = style(body);
      const htmlStyle = style(htmlEl);

      return {
        htmlLength: html.length,
        visibleTextLength: visibleText.length,
        styles: {
          bodyBg: bodyStyle.bg,
          bodyColor: bodyStyle.color,
          htmlBg: htmlStyle.bg,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
          },
        },
      };
    })
    .catch(() => ({ htmlLength: 0, visibleTextLength: 0 }));

  return {
    status,
    finalUrl: page.url(),
    title,
    htmlLength: stats.htmlLength,
    visibleTextLength: stats.visibleTextLength,
    styles: 'styles' in stats ? (stats as unknown as { styles: CaptureDebug['styles'] }).styles : undefined,
  };
}

async function captureOneViewport(params: {
  context: BrowserContext;
  route: { path: string; url: string };
  viewportName: ViewportName;
  outputTilesDir: string;
  routeSlug: string;
  skip: boolean;
}): Promise<{ debug?: CaptureDebug; tiles: { index: number; path: string; yOffset: number }[]; error?: string }> {
  if (params.skip) return { tiles: [] };

  const viewport = VIEWPORTS[params.viewportName];
  const page: Page = await params.context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const push = function push(target: string[], value: string): void {
    if (target.length >= MAX_ERROR_LINES) return;
    if (!value.trim()) return;
    target.push(value);
  };

  page.on('console', function onConsole(msg) {
    if (msg.type() !== 'error') return;
    push(consoleErrors, `[console.${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', function onPageError(err) {
    push(pageErrors, `[pageerror] ${err instanceof Error ? err.message : String(err)}`);
  });
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const nav = await page.goto(params.route.url, { waitUntil: 'domcontentloaded', timeout: PAGE_GOTO_TIMEOUT_MS });
    const status = nav?.status() ?? null;
    if (typeof status === 'number' && status >= 400) {
      const dbg = await debug(page, status);
      dbg.errors = { console: consoleErrors, page: pageErrors };
      return { tiles: [], debug: dbg, error: `navigation returned HTTP ${status}` };
    }
    await wait(page);
    await dismissCookieConsent(page);
    const dbg = await debug(page, status);
    dbg.errors = { console: consoleErrors, page: pageErrors };

    const result = await captureTiles({
      page,
      viewport,
      outDir: params.outputTilesDir,
      routeSlug: params.routeSlug,
    });
    return { tiles: result.tiles, debug: dbg, error: result.captureError };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function captureSite(params: {
  previewUrl: string;
  context: BrowserContext;
  homepagePage: Page;
  outputDir: string;
  maxRoutes: number;
}): Promise<CapturedSite> {
  const startedAt = Date.now();
  const errors: string[] = [];

  await mkdir(params.outputDir, { recursive: true });

  const routes = await discoverRoutes({
    previewUrl: params.previewUrl,
    page: params.homepagePage,
    maxRoutes: params.maxRoutes,
  });

  const perRoute: CapturedSite['perRoute'] = [];
  const outputTilesDir = path.join(params.outputDir, 'tiles');

  for (const route of routes) {
    const routeSlug = slugifyPath(route.path);
    const perViewport: CapturedSite['perRoute'][number]['perViewport'] = {
      mobile: { tiles: [] },
      laptop: { tiles: [] },
    };

    let skipRemaining = false;
    for (const vpName of VIEWPORT_ORDER) {
      try {
        const result = await captureOneViewport({
          context: params.context,
          route,
          viewportName: vpName,
          outputTilesDir,
          routeSlug,
          skip: skipRemaining,
        });
        perViewport[vpName] = {
          tiles: result.tiles,
          ...(result.debug ? { debug: result.debug } : {}),
          ...(result.error ? { error: result.error } : {}),
        };
        if (result.error) errors.push(`${route.path} @ ${vpName}: ${result.error}`);
        if (!result.tiles.length && vpName === 'mobile') {
          // If the first viewport fails to capture tiles, skip remaining viewports for this route.
          skipRemaining = true;
        }
      } catch (err) {
        const msg = `${route.path} @ ${vpName}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        perViewport[vpName] = { tiles: [], error: msg };
      }
    }

    perRoute.push({
      path: route.path,
      url: route.url,
      perViewport,
    });
  }

  const capture: CapturedSite = {
    previewUrl: params.previewUrl,
    generatedAt: new Date().toISOString(),
    maxRoutes: params.maxRoutes,
    routes,
    perRoute,
    errors,
  };

  await writeFile(
    path.join(params.outputDir, 'capture.json'),
    `${JSON.stringify(capture, null, 2)}\n`,
  );

  return capture;
}
