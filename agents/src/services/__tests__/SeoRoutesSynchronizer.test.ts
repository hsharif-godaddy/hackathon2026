import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseTs } from '@babel/parser';

import { synchronizeSeoRoutes } from '../SeoRoutesSynchronizer.js';

function expectValidTypeScript(source: string): void {
  expect(() =>
    parseTs(source, { sourceType: 'module', plugins: ['typescript'] }),
  ).not.toThrow();
}

const tempDirs: string[] = [];

async function createApp(routesSource: string, seoRoutesSource?: string): Promise<string> {
  const appPath = await mkdtemp(join(tmpdir(), 'seo-routes-sync-'));
  tempDirs.push(appPath);

  await mkdir(join(appPath, 'src', 'lib'), { recursive: true });
  await writeFile(join(appPath, 'src', 'routes.tsx'), routesSource, 'utf-8');

  if (seoRoutesSource) {
    await writeFile(join(appPath, 'src', 'lib', 'seo-routes.ts'), seoRoutesSource, 'utf-8');
  }

  return appPath;
}

async function readSeoRoutes(appPath: string): Promise<string> {
  return await readFile(join(appPath, 'src', 'lib', 'seo-routes.ts'), 'utf-8');
}

describe('SeoRoutesSynchronizer', function syncTests() {
  afterEach(async function cleanup() {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes static public routes to seo-routes.ts', async function writeStaticRoutes() {
    const appPath = await createApp(`
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/about', element: <AboutPage /> },
  { path: '/services/web-design', element: <ServicePage /> },
  { path: '/products/:id', element: <ProductPage /> },
  { path: '*', element: <NotFoundPage /> },
];
`);

    const result = await synchronizeSeoRoutes(appPath);

    expect(result.status).toBe('synced');
    expect(result.routes.map((route) => route.path)).toEqual([
      '/',
      '/about',
      '/services/web-design',
    ]);
    await expect(readSeoRoutes(appPath)).resolves.toContain('{ path: "/about", changefreq: "monthly", priority: 0.8 },');
  });

  it('preserves existing metadata for routes that remain', async function preserveMetadata() {
    const appPath = await createApp(
      `
export const routes = [
  { path: '/', element: <HomePage /> },
  { path: '/about', element: <AboutPage /> },
];
`,
      `
export const seoRoutes = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/about", changefreq: "weekly", priority: 0.9, lastmod: "2026-05-01" },
];
`,
    );

    const result = await synchronizeSeoRoutes(appPath);

    expect(result.status).toBe('synced');
    expect(result.routes).toContainEqual({
      path: '/about',
      changefreq: 'weekly',
      priority: 0.9,
      lastmod: '2026-05-01',
    });
    await expect(readSeoRoutes(appPath)).resolves.toContain(
      '{ path: "/about", changefreq: "weekly", priority: 0.9, lastmod: "2026-05-01" },',
    );
  });

  it('skips non-literal routes exports without writing seo-routes.ts', async function skipNonLiteral() {
    const appPath = await createApp(`
export const routes = createRoutes();
`);

    const result = await synchronizeSeoRoutes(appPath);

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'routes export is not a literal array',
      routes: [],
    });
    await expect(readSeoRoutes(appPath)).rejects.toThrow();
  });

  it('removes metadata for routes that no longer exist', async function removeDeletedRoutes() {
    const appPath = await createApp(
      `
export const routes = [
  { path: '/', element: <HomePage /> },
];
`,
      `
export const seoRoutes = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/old", changefreq: "monthly", priority: 0.8 },
];
`,
    );

    await synchronizeSeoRoutes(appPath);

    const updated = await readSeoRoutes(appPath);
    expect(updated).not.toContain('/old');
    expect(updated).toContain('{ path: "/", changefreq: "weekly", priority: 1.0 },');
    // Guard against a regression that wipes the whole array or emits invalid TS.
    expectValidTypeScript(updated);
  });

  it('flattens nested children, with absolute child paths overriding parent', async function nestedChildren() {
    const appPath = await createApp(`
export const routes = [
  { path: '/dashboard', element: <Dashboard />, children: [
    { path: 'analytics', element: <Analytics /> },
    { path: '/admin/users', element: <AdminUsers /> },
  ]},
];
`);

    const result = await synchronizeSeoRoutes(appPath);

    expect(result.status).toBe('synced');
    expect(result.routes.map((r) => r.path).sort()).toEqual([
      '/admin/users',
      '/dashboard',
      '/dashboard/analytics',
    ]);
  });

  it('skips and returns reason when routes.tsx fails to parse', async function skipParseFailure() {
    // Intentionally broken: unmatched brace + dangling comma + bad JSX
    const appPath = await createApp(`
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage }, // syntax error
  { path: '/about', element <AboutPage /> },
];
`);

    const result = await synchronizeSeoRoutes(appPath);

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toMatch(/^could not parse routes\.tsx:/);
    }
    expect(result.routes).toEqual([]);
    // seo-routes.ts must not exist (we never created one in this test) and must not be created
    await expect(readSeoRoutes(appPath)).rejects.toThrow();
  });

  it('drops template-literal path values silently (cannot statically resolve)', async function templateLiteralPaths() {
    // Mixed literal + template-literal: template-literal paths are dropped,
    // literal paths still sync. Documents the intentional behavior.
    const appPath = await createApp(`
export const routes = [
  { path: '/', element: <HomePage /> },
  { path: \`/blog/\${slug}\`, element: <BlogPost /> },
  { path: '/about', element: <About /> },
];
`);

    const result = await synchronizeSeoRoutes(appPath);

    expect(result.status).toBe('synced');
    expect(result.routes.map((r) => r.path).sort()).toEqual(['/', '/about']);
  });

  it('clamps out-of-range priority and drops malformed lastmod', async function validateMetadata() {
    const appPath = await createApp(
      `
export const routes = [
  { path: '/', element: <Home /> },
  { path: '/news', element: <News /> },
  { path: '/legal', element: <Legal /> },
];
`,
      `
export const seoRoutes = [
  { path: "/", changefreq: "weekly", priority: 5.0 },
  { path: "/news", changefreq: "daily", priority: 0.7, lastmod: "tomorrow" },
  { path: "/legal", changefreq: "yearly", priority: 0.5, lastmod: "2026-05-01" },
];
`,
    );

    const result = await synchronizeSeoRoutes(appPath);

    expect(result.status).toBe('synced');
    if (result.status === 'synced') {
      const byPath = new Map(result.routes.map((r) => [r.path, r]));
      // Out-of-range priority 5.0 → clamped to upper bound 1.0
      expect(byPath.get('/')?.priority).toBe(1);
      // In-range priority preserved; valid ISO-8601 lastmod preserved
      expect(byPath.get('/legal')?.priority).toBe(0.5);
      expect(byPath.get('/legal')?.lastmod).toBe('2026-05-01');
      // In-range priority preserved; malformed lastmod ("tomorrow") dropped
      expect(byPath.get('/news')?.priority).toBe(0.7);
      expect(byPath.get('/news')?.lastmod).toBeUndefined();
    }
  });

  it('preserves curated seo-routes.ts when parse succeeds but yields zero static paths', async function skipEmptyPaths() {
    // routes.tsx parses cleanly but every path is a non-literal (e.g. const ref or
    // template literal). Without the guard, this would overwrite seo-routes.ts
    // with an empty array and silently drop priority/changefreq/lastmod.
    const appPath = await createApp(
      `
const HOME = '/';
export const routes = [
  { path: HOME, element: <HomePage /> },
  { path: \`/blog/\${slug}\`, element: <BlogPage /> },
];
`,
      `
export const seoRoutes = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/about", changefreq: "monthly", priority: 0.8 },
];
`,
    );

    const result = await synchronizeSeoRoutes(appPath);

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toMatch(/preserving existing seo-routes\.ts/);
    }
    // The existing curated metadata must survive byte-for-byte
    const after = await readSeoRoutes(appPath);
    expect(after).toContain('{ path: "/", changefreq: "weekly", priority: 1.0 }');
    expect(after).toContain('{ path: "/about", changefreq: "monthly", priority: 0.8 }');
  });
});
