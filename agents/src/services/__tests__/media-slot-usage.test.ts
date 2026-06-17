import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { computeSlotUsageByRoute, clearSlotUsageCache, sourcePathToRoute } from '../media-slot-usage.js';

const createdDirs: string[] = [];

function makeApp(files: Record<string, string>): string {
  const appPath = mkdtempSync(join(tmpdir(), 'slot-usage-'));
  createdDirs.push(appPath);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(appPath, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return appPath;
}

describe('media-slot-usage', () => {
  afterEach(() => {
    clearSlotUsageCache();
    for (const dir of createdDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  describe('sourcePathToRoute', () => {
    it('maps index file to root route', () => {
      const appPath = '/app';
      expect(sourcePathToRoute(join(appPath, 'src/pages/index.tsx'), appPath)).toBe('/');
    });

    it('maps named page file to its route', () => {
      const appPath = '/app';
      expect(sourcePathToRoute(join(appPath, 'src/pages/menu.tsx'), appPath)).toBe('/menu');
    });

    it('maps nested index file to its directory route', () => {
      const appPath = '/app';
      expect(sourcePathToRoute(join(appPath, 'src/pages/blog/index.tsx'), appPath)).toBe('/blog');
    });

    it('maps nested page file to a nested route', () => {
      const appPath = '/app';
      expect(sourcePathToRoute(join(appPath, 'src/pages/blog/post.tsx'), appPath)).toBe('/blog/post');
    });
  });

  describe('computeSlotUsageByRoute', () => {
    it('collects slot literals directly referenced in a page file', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `
          export default function Home() {
            return <img src="/airo-assets/images/pages/home/hero" />;
          }
        `,
        'src/pages/menu.tsx': `
          const dishes = [
            { slot: '/airo-assets/images/menu/classic-southern' },
            { slot: '/airo-assets/images/menu/sides-spread' },
          ];
          export default function Menu() {
            return <Dishes items={dishes} />;
          }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/']).toEqual(['pages/home/hero']);
      expect(usage['/menu']).toEqual(['menu/classic-southern', 'menu/sides-spread']);
    });

    it('detects cross-page reuse: a slot rendered on two pages appears in both routes', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `
          // Home features one of the menu dishes
          const featured = '/airo-assets/images/menu/classic-southern';
          export default function Home() { return <img src={featured} />; }
        `,
        'src/pages/menu.tsx': `
          const dishes = ['/airo-assets/images/menu/classic-southern', '/airo-assets/images/menu/spicy-korean'];
          export default function Menu() { return null; }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/']).toContain('menu/classic-southern');
      expect(usage['/menu']).toContain('menu/classic-southern');
      expect(usage['/menu']).toContain('menu/spicy-korean');
    });

    it('follows relative imports into components to collect their slots', () => {
      const appPath = makeApp({
        'src/pages/about.tsx': `
          import { Gallery } from '../components/Gallery';
          export default function About() { return <Gallery />; }
        `,
        'src/components/Gallery.tsx': `
          export function Gallery() {
            return <img src="/airo-assets/images/about/kitchen" />;
          }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/about']).toEqual(['about/kitchen']);
    });

    it('follows @/ alias imports', () => {
      const appPath = makeApp({
        'src/pages/about.tsx': `
          import { Banner } from '@/components/Banner';
          export default function About() { return <Banner />; }
        `,
        'src/components/Banner.tsx': `
          export function Banner() {
            return <div style={{ backgroundImage: 'url(/airo-assets/images/about/banner)' }} />;
          }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/about']).toEqual(['about/banner']);
    });

    it('merges global layout slots (e.g. logo) into every page route', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `
          export default function Home() { return <img src="/airo-assets/images/pages/home/hero" />; }
        `,
        'src/pages/menu.tsx': `
          export default function Menu() { return <img src="/airo-assets/images/menu/sides-spread" />; }
        `,
        'src/layouts/parts/Header.tsx': `
          export function Header() { return <img src="/airo-assets/images/logo/horizontal" />; }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/']).toContain('logo/horizontal');
      expect(usage['/menu']).toContain('logo/horizontal');
      // Page-specific slots come first, global slots appended.
      expect(usage['/']?.[0]).toBe('pages/home/hero');
    });

    it('does not treat page slots as global when App.tsx imports every page (router)', () => {
      // App.tsx is the router: it imports every page. The global-chrome walk
      // must NOT descend into those page imports, or every page's slots would
      // be mislabeled sitewide and leak into all routes.
      const appPath = makeApp({
        'src/App.tsx': `
          import Home from './pages/index';
          import Menu from './pages/menu';
          import { Layout } from './layouts/Layout';
          export default function App() {
            return <Layout><Home /><Menu /></Layout>;
          }
        `,
        'src/layouts/Layout.tsx': `
          export function Layout({ children }) {
            return <div><img src="/airo-assets/images/logo/horizontal" />{children}</div>;
          }
        `,
        'src/pages/index.tsx': `
          export default function Home() { return <img src="/airo-assets/images/pages/home/hero" />; }
        `,
        'src/pages/menu.tsx': `
          export default function Menu() { return <img src="/airo-assets/images/menu/street-corn" />; }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      // The menu-only slot stays on /menu and never leaks to / via App.tsx.
      expect(usage['/menu']).toContain('menu/street-corn');
      expect(usage['/']).not.toContain('menu/street-corn');
      // The genuine global logo still merges into every route.
      expect(usage['/']).toContain('logo/horizontal');
      expect(usage['/menu']).toContain('logo/horizontal');
    });

    it('excludes the /404 route', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `export default function Home() { return null; }`,
        'src/pages/404.tsx': `
          export default function NotFound() { return <img src="/airo-assets/images/error/oops" />; }
        `,
        'src/pages/_404.tsx': `
          export default function NotFoundUnderscore() { return <img src="/airo-assets/images/error/oops2" />; }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/404']).toBeUndefined();
      expect(usage['/_404']).toBeUndefined();
    });

    it('strips asset file extensions from slot paths', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `
          export default function Home() { return <img src="/airo-assets/images/pages/home/hero.png" />; }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/']).toEqual(['pages/home/hero']);
    });

    it('deduplicates a slot referenced multiple times within a page', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `
          const a = '/airo-assets/images/pages/home/hero';
          const b = '/airo-assets/images/pages/home/hero';
          export default function Home() { return <img src={a || b} />; }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/']).toEqual(['pages/home/hero']);
    });

    it('does not follow bare node-module imports', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `
          import React from 'react';
          import { Helmet } from '@dr.pogodin/react-helmet';
          export default function Home() { return <img src="/airo-assets/images/pages/home/hero" />; }
        `,
      });

      const usage = computeSlotUsageByRoute(appPath);

      expect(usage['/']).toEqual(['pages/home/hero']);
    });

    it('returns an empty map when there are no page files', () => {
      const appPath = makeApp({
        'src/components/Foo.tsx': `export const Foo = () => null;`,
      });

      expect(computeSlotUsageByRoute(appPath)).toEqual({});
    });
  });

  describe('cache invalidation', () => {
    it('returns the cached result on a repeat call when source is unchanged', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `export default function Home() { return <img src="/airo-assets/images/pages/home/hero" />; }`,
      });

      const first = computeSlotUsageByRoute(appPath);
      const second = computeSlotUsageByRoute(appPath);

      // Same object reference => served from cache (no recompute).
      expect(second).toBe(first);
    });

    it('recomputes after clearSlotUsageCache invalidates the entry', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `export default function Home() { return <img src="/airo-assets/images/pages/home/hero" />; }`,
      });

      const first = computeSlotUsageByRoute(appPath);
      clearSlotUsageCache(appPath);
      const second = computeSlotUsageByRoute(appPath);

      expect(second).not.toBe(first);
      expect(second).toEqual(first);
    });

    it('reflects a newly added page without an explicit cache clear (fingerprint changes)', () => {
      const appPath = makeApp({
        'src/pages/index.tsx': `export default function Home() { return <img src="/airo-assets/images/pages/home/hero" />; }`,
      });

      const before = computeSlotUsageByRoute(appPath);
      expect(before['/menu']).toBeUndefined();

      // Simulate a build/commit adding a new page after the first read cached.
      const menuPath = join(appPath, 'src/pages/menu.tsx');
      mkdirSync(dirname(menuPath), { recursive: true });
      writeFileSync(menuPath, `export default function Menu() { return <img src="/airo-assets/images/menu/sides-spread" />; }`);

      const after = computeSlotUsageByRoute(appPath);

      expect(after['/menu']).toEqual(['menu/sides-spread']);
    });
  });
});


