import { describe, expect, it, vi } from 'vitest';
import { parse as parseTs } from '@babel/parser';

import type { CreateForWorkspace } from '../../workspace/client.js';
import { WorkspaceUnavailableError } from '../../workspace/errors.js';
import { createMockWorkspaceFiles, type MockWorkspaceFiles } from '../../workspace/__tests__/mock-helpers.js';
import { DevSupervisorError } from '../DevSupervisorClient.js';
import { synchronizeSeoRoutes } from '../SeoRoutesSynchronizer.js';

const appId = 'app1234567';
const ROUTES_PATH = 'src/routes.tsx';
const SEO_ROUTES_PATH = 'src/lib/seo-routes.ts';

function expectValidTypeScript(source: string): void {
  expect(() =>
    parseTs(source, { sourceType: 'module', plugins: ['typescript'] }),
  ).not.toThrow();
}

interface MockWorkspace {
  store: Map<string, string>;
  view: ReturnType<typeof vi.fn>;
  readText: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  factory: CreateForWorkspace;
}

function setup(routesSource: string, seoRoutesSource?: string): MockWorkspace {
  const seed: Record<string, string> = { [ROUTES_PATH]: routesSource };
  if (seoRoutesSource !== undefined) seed[SEO_ROUTES_PATH] = seoRoutesSource;
  const mock: MockWorkspaceFiles = createMockWorkspaceFiles(seed);
  const factory = vi.fn(() => ({ files: mock.files })) as unknown as CreateForWorkspace;
  return { store: mock.store, view: mock.spies.view, readText: mock.spies.readText, write: mock.spies.write, factory };
}

describe('SeoRoutesSynchronizer', function syncTests() {
  it('writes static public routes to seo-routes.ts', async function writeStaticRoutes() {
    const ws = setup(`
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/about', element: <AboutPage /> },
  { path: '/services/web-design', element: <ServicePage /> },
  { path: '/products/:id', element: <ProductPage /> },
  { path: '*', element: <NotFoundPage /> },
];
`);

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    expect(result.status).toBe('synced');
    expect(result.warnings).toEqual([]);
    expect(result.routes.map((route) => route.path)).toEqual([
      '/',
      '/about',
      '/services/web-design',
    ]);
    expect(ws.factory).toHaveBeenCalledWith(appId, 'preview');
    // Assert the exact write payload (path + content, no stray encoding/createOnly).
    expect(ws.write).toHaveBeenCalledWith({
      path: SEO_ROUTES_PATH,
      content: ws.store.get(SEO_ROUTES_PATH),
    });
    expect(ws.store.get(SEO_ROUTES_PATH)).toContain(
      '{ path: "/about", changefreq: "monthly", priority: 0.8 },',
    );
  });

  it('preserves existing metadata for routes that remain', async function preserveMetadata() {
    const ws = setup(
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

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    expect(result.status).toBe('synced');
    expect(result.routes).toContainEqual({
      path: '/about',
      changefreq: 'weekly',
      priority: 0.9,
      lastmod: '2026-05-01',
    });
    expect(ws.store.get(SEO_ROUTES_PATH)).toContain(
      '{ path: "/about", changefreq: "weekly", priority: 0.9, lastmod: "2026-05-01" },',
    );
  });

  it('skips non-literal routes exports without writing seo-routes.ts', async function skipNonLiteral() {
    const ws = setup(`
export const routes = createRoutes();
`);

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'routes export is not a literal array',
      routes: [],
    });
    expect(ws.write).not.toHaveBeenCalled();
    expect(ws.store.has(SEO_ROUTES_PATH)).toBe(false);
  });

  it('removes metadata for routes that no longer exist', async function removeDeletedRoutes() {
    const ws = setup(
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

    await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    const updated = ws.store.get(SEO_ROUTES_PATH) ?? '';
    expect(updated).not.toContain('/old');
    expect(updated).toContain('{ path: "/", changefreq: "weekly", priority: 1.0 },');
    // Guard against a regression that wipes the whole array or emits invalid TS.
    expectValidTypeScript(updated);
  });

  it('flattens nested children, with absolute child paths overriding parent', async function nestedChildren() {
    const ws = setup(`
export const routes = [
  { path: '/dashboard', element: <Dashboard />, children: [
    { path: 'analytics', element: <Analytics /> },
    { path: '/admin/users', element: <AdminUsers /> },
  ]},
];
`);

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    expect(result.status).toBe('synced');
    expect(result.routes.map((r) => r.path).sort()).toEqual([
      '/admin/users',
      '/dashboard',
      '/dashboard/analytics',
    ]);
  });

  it('skips and returns reason when routes.tsx fails to parse', async function skipParseFailure() {
    // Intentionally broken: unmatched brace + dangling comma + bad JSX
    const ws = setup(`
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage }, // syntax error
  { path: '/about', element <AboutPage /> },
];
`);

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toMatch(/^could not parse routes\.tsx:/);
    }
    expect(result.routes).toEqual([]);
    // seo-routes.ts must not be written when routes.tsx cannot be parsed.
    expect(ws.write).not.toHaveBeenCalled();
    expect(ws.store.has(SEO_ROUTES_PATH)).toBe(false);
  });

  it('drops template-literal path values silently (cannot statically resolve)', async function templateLiteralPaths() {
    // Mixed literal + template-literal: template-literal paths are dropped,
    // literal paths still sync. Documents the intentional behavior.
    const ws = setup(`
export const routes = [
  { path: '/', element: <HomePage /> },
  { path: \`/blog/\${slug}\`, element: <BlogPost /> },
  { path: '/about', element: <About /> },
];
`);

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    expect(result.status).toBe('synced');
    expect(result.routes.map((r) => r.path).sort()).toEqual(['/', '/about']);
  });

  it('clamps out-of-range priority and drops malformed lastmod', async function validateMetadata() {
    const ws = setup(
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

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

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
    const ws = setup(
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

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toMatch(/preserving existing seo-routes\.ts/);
    }
    // No write happened, so the curated metadata survives byte-for-byte.
    expect(ws.write).not.toHaveBeenCalled();
    const after = ws.store.get(SEO_ROUTES_PATH) ?? '';
    expect(after).toContain('{ path: "/", changefreq: "weekly", priority: 1.0 }');
    expect(after).toContain('{ path: "/about", changefreq: "monthly", priority: 0.8 }');
  });

  it('skips when routes.tsx does not exist', async function missingRoutes() {
    const mock: MockWorkspaceFiles = createMockWorkspaceFiles({});
    const factory = vi.fn(() => ({ files: mock.files })) as unknown as CreateForWorkspace;
    const ws = { store: mock.store, view: mock.spies.view, write: mock.spies.write, factory };

    const result = await synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('could not read routes.tsx: not found');
    }
    expect(ws.write).not.toHaveBeenCalled();
  });

  it('propagates non-not_found transport failures reading routes.tsx', async function routesTransportFailure() {
    const ws = setup('export const routes = [];');
    ws.readText.mockRejectedValueOnce(
      new DevSupervisorError('permission_denied', 403, `${ROUTES_PATH}: permission denied`),
    );

    await expect(
      synchronizeSeoRoutes(appId, { workspaceFactory: ws.factory }),
    ).rejects.toThrow('permission denied');
    expect(ws.write).not.toHaveBeenCalled();
  });

  it('propagates non-not_found transport failures reading existing seo-routes.ts', async function existingTransportFailure() {
    const routesSource = `
export const routes = [
  { path: '/', element: <Home /> },
];
`;
    const readText = vi.fn(async ({ path }: { path: string }) => {
      if (path === ROUTES_PATH) {
        return routesSource;
      }
      throw new DevSupervisorError('permission_denied', 403, `${path}: permission denied`);
    });
    const write = vi.fn();
    const factory = vi.fn(() => ({ files: { readText, write } })) as unknown as CreateForWorkspace;

    await expect(
      synchronizeSeoRoutes(appId, { workspaceFactory: factory }),
    ).rejects.toThrow('permission denied');
    expect(write).not.toHaveBeenCalled();
  });

  it('throws when no workspace can be bound for the app', async function workspaceUnavailable() {
    const factory = vi.fn(() => null) as unknown as CreateForWorkspace;

    await expect(
      synchronizeSeoRoutes(appId, { workspaceFactory: factory }),
    ).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });
});
