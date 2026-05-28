/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  normalizeImport,
  parseRoutesText,
  resolveRouteForModule,
  routesMatch,
} from '../route-discovery';

describe('parseRoutesText', () => {
  it('extracts paths and module imports from a typical v8 routes.tsx', () => {
    const source = `
      import { lazy } from 'react';
      const About = lazy(() => import('./pages/about'));
      const Contact = lazy(() => import('./pages/contact'));
      export const routes = [
        { path: '/', element: <Home /> },
        { path: '/about', element: <About /> },
        { path: '/contact', element: <Contact /> },
        { path: '*', element: <NotFound /> },
      ];
    `;

    const entries = parseRoutesText(source);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({ path: '/', modulePath: null });
    // `lazy(() => import('./pages/about'))` lookback resolves the import.
    expect(entries[1]?.path).toBe('/about');
    expect(entries[1]?.modulePath).toBe('src/pages/about.tsx');
    expect(entries[2]?.path).toBe('/contact');
    expect(entries[2]?.modulePath).toBe('src/pages/contact.tsx');
    expect(entries[3]?.path).toBe('*');
  });

  it('handles skill-installed routes mapped to non-filename paths (Catalog → /shop)', () => {
    const source = `
      const Catalog = lazy(() => import('./pages/Catalog'));
      export const routes = [
        { path: '/shop', element: <Catalog /> },
      ];
    `;
    const entries = parseRoutesText(source);
    expect(entries).toEqual([{ path: '/shop', modulePath: 'src/pages/Catalog.tsx' }]);
  });

  it('returns an empty list when no path: literals are present', () => {
    const entries = parseRoutesText('export const routes = [];');
    expect(entries).toEqual([]);
  });

  it('handles dynamic segment paths', () => {
    const source = `
      const Post = lazy(() => import('./pages/blog/[slug]'));
      const routes = [{ path: '/blog/:slug', element: <Post /> }];
    `;
    const entries = parseRoutesText(source);
    expect(entries[0]?.path).toBe('/blog/:slug');
  });
});

describe('normalizeImport', () => {
  it.each([
    ['./pages/Catalog', 'src/pages/Catalog.tsx'],
    ['../pages/about.tsx', 'src/pages/about.tsx'],
    ['@/pages/contact', 'src/pages/contact.tsx'],
    ['/src/pages/index', 'src/pages/index.tsx'],
    ['./pages/blog/index.tsx', 'src/pages/blog/index.tsx'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeImport(input)).toBe(expected);
  });
});

describe('routesMatch', () => {
  it('exact paths match', () => {
    expect(routesMatch('/about', '/about')).toBe(true);
    expect(routesMatch('/', '/')).toBe(true);
  });

  it('non-matching paths do not match', () => {
    expect(routesMatch('/about', '/contact')).toBe(false);
    expect(routesMatch('/', '/about')).toBe(false);
  });

  it('dynamic segments match concrete values', () => {
    expect(routesMatch('/blog/:slug', '/blog/intro')).toBe(true);
    expect(routesMatch('/blog/:slug', '/blog/intro/extra')).toBe(false);
  });

  it('catch-all patterns are not treated as matches', () => {
    expect(routesMatch('*', '/anything')).toBe(false);
    expect(routesMatch('/*', '/anything')).toBe(false);
    expect(routesMatch('/admin/*', '/admin/users')).toBe(false);
  });
});

describe('resolveRouteForModule', () => {
  const ROUTES_BASE = `
    const About = lazy(() => import('./pages/about'));
    const Catalog = lazy(() => import('./pages/Catalog'));
    const routes = [
      { path: '/', element: <Home /> },
      { path: '/about', element: <About /> },
      { path: '/shop', element: <Catalog /> },
      { path: '*', element: <NotFound /> },
    ];
  `;

  beforeEach(() => {
    __resetForTests();
    // Mock global fetch so discoverRoutes can pull the routes text.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => ROUTES_BASE,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetForTests();
  });

  it('returns the registered path when modulePath matches a non-filename route (skill page)', async () => {
    const target = await resolveRouteForModule(
      { url: '/Catalog', modulePath: 'src/pages/Catalog.tsx' },
      '/some-other-page',
    );
    // Registry win: Catalog.tsx is mounted at /shop, not /Catalog.
    expect(target).toBe('/shop');
  });

  it('returns the URL when the registry confirms it (filename heuristic worked)', async () => {
    const target = await resolveRouteForModule(
      { url: '/about', modulePath: 'src/pages/about.tsx' },
      '/contact',
    );
    expect(target).toBe('/about');
  });

  it('returns null when the URL is not registered and no modulePath registry hit exists', async () => {
    // /unknown has no route entry; modulePath also missing.
    const target = await resolveRouteForModule(
      { url: '/unknown', modulePath: null },
      '/somewhere',
    );
    expect(target).toBeNull();
  });

  it('returns null when target equals current path (no-op)', async () => {
    const target = await resolveRouteForModule(
      { url: '/about', modulePath: 'src/pages/about.tsx' },
      '/about',
    );
    expect(target).toBeNull();
  });

  it('returns null for empty hint', async () => {
    const target = await resolveRouteForModule(
      { url: null, modulePath: null },
      '/anywhere',
    );
    expect(target).toBeNull();
  });

  it('falls back to the URL when discovery fails (fetch rejects)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );

    const target = await resolveRouteForModule(
      { url: '/about', modulePath: 'src/pages/about.tsx' },
      '/contact',
    );
    // Registry probe failed; trust the server hint rather than block the user.
    expect(target).toBe('/about');
  });

  it('falls back to the URL when /src/routes.tsx is missing (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, text: async () => '' })),
    );

    const target = await resolveRouteForModule(
      { url: '/about', modulePath: 'src/pages/about.tsx' },
      '/contact',
    );
    expect(target).toBe('/about');
  });

  it('prefers registry modulePath hit over a wrong-looking URL', async () => {
    // Server's filename-derived hint says /Catalog (which would 404), but
    // modulePath registry resolves to /shop.
    const target = await resolveRouteForModule(
      { url: '/Catalog', modulePath: 'src/pages/Catalog.tsx' },
      '/',
    );
    expect(target).toBe('/shop');
  });
});
