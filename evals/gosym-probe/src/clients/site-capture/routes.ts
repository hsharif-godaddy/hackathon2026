import type { Page } from 'playwright';
import { Agent } from 'undici';

import type { DiscoveredRoute, RouteStatus } from './types.js';

const HTTP_CHECK_TIMEOUT_MS = 10_000;

const MAX_ROUTES = 20;

function normalizePath(p: string): string | null {
  if (!p) return null;
  try {
    const withScheme = p.startsWith('http')
      ? p
      : `http://example.com${p.startsWith('/') ? '' : '/'}${p}`;
    const url = new URL(withScheme);
    let path = url.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    return path;
  } catch {
    return null;
  }
}

// SPA hosts (Netlify, Vercel, Cloudflare Pages) 404 on HEAD for unknown paths
// but rewrite GET to index.html. Always use GET to avoid false-404s on
// perfectly valid client-side routes.
function classifyStatus(status: number | undefined): RouteStatus {
  if (status === undefined) return 'unreachable';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'redirect';
  if (status === 404) return 'notFound';
  if (status >= 400 && status < 500) return 'notFound';
  if (status >= 500) return 'serverError';
  return 'unreachable';
}

async function httpCheck(
  url: string,
  ignoreHttpsErrors: boolean,
): Promise<{ status: RouteStatus; httpStatus?: number; note?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS);
  try {
    const fetchOptions: RequestInit = {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    };
    if (ignoreHttpsErrors) {
      (fetchOptions as RequestInit & { dispatcher: unknown }).dispatcher =
        new Agent({ connect: { rejectUnauthorized: false } }); // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
    }
    const resp = await fetch(url, fetchOptions);
    // Cancel body stream immediately — we only need the status code.
    resp.body?.cancel();
    return { status: classifyStatus(resp.status), httpStatus: resp.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'unreachable', note: 'request timed out' };
    }
    return {
      status: 'unreachable',
      note: err instanceof Error ? err.message : 'unknown error',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function routesFromHomepageCrawl(
  page: Page,
  origin: string,
): Promise<string[]> {
  const hrefs = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href]'),
    );
    return anchors
      .map((a) => a.getAttribute('href') || '')
      .filter(Boolean);
  });

  const paths = new Set<string>();
  for (const href of hrefs) {
    try {
      const resolved = new URL(href, origin);
      if (resolved.origin !== origin) continue;
      const p = normalizePath(resolved.pathname);
      if (p) paths.add(p);
    } catch {
      continue;
    }
  }
  return Array.from(paths);
}

export interface DiscoverRoutesInput {
  previewUrl: string;
  page: Page;
  ignoreHttpsErrors?: boolean;
  maxRoutes?: number;
}

export async function discoverRoutes(
  input: DiscoverRoutesInput,
): Promise<DiscoveredRoute[]> {
  const { previewUrl, page } = input;
  const max = input.maxRoutes ?? MAX_ROUTES;
  const ignoreHttpsErrors = input.ignoreHttpsErrors ?? false;

  const origin = new URL(previewUrl).origin;
  const crawlPaths = await routesFromHomepageCrawl(page, origin);

  const paths = new Set<string>(['/']);
  for (const p of crawlPaths) paths.add(p);

  const ordered = Array.from(paths).slice(0, max);

  return Promise.all(
    ordered.map(async (path) => {
      const url = `${origin}${path === '/' ? '' : path}`;
      const check = await httpCheck(url, ignoreHttpsErrors);
      return {
        path,
        url,
        origin: path === '/' ? 'homepage' : 'crawl',
        status: check.status,
        httpStatus: check.httpStatus,
        note: check.note,
      } satisfies DiscoveredRoute;
    }),
  );
}
