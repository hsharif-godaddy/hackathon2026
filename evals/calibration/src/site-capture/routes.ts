import type { Page } from 'playwright';

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

async function routesFromHomepageCrawl(page: Page, origin: string): Promise<string[]> {
  const hrefs = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    return anchors.map((a) => a.getAttribute('href') || '').filter(Boolean);
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

export async function discoverRoutes(input: {
  previewUrl: string;
  page: Page;
  maxRoutes: number;
}): Promise<{ path: string; url: string }[]> {
  const origin = new URL(input.previewUrl).origin;
  const crawlPaths = await routesFromHomepageCrawl(input.page, origin);

  const paths = new Set<string>(['/']);
  for (const p of crawlPaths) paths.add(p);

  return Array.from(paths)
    .slice(0, input.maxRoutes)
    .map((path) => ({
      path,
      url: `${origin}${path === '/' ? '' : path}`,
    }));
}

