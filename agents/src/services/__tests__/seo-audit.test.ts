import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseSeoRoutePaths,
  discoverSeoRoutes,
  discoverPageRoutes,
  discoverAllAuditableRoutes,
  isExcludedFromSeoAudit,
  runSeoAudit,
  runSeoCheck,
  logPublishedSeoAudit,
} from '../seo-audit.js';

describe('seo-audit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parseSeoRoutePaths extracts paths from seo-routes.ts', () => {
    const content = `
      export const seoRoutes = [
        { path: "/", priority: 1 },
        { path: "/about", priority: 0.8 },
      ];
    `;
    expect(parseSeoRoutePaths(content)).toEqual(['/', '/about']);
  });

  it('discoverSeoRoutes reads app seo-routes file', () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      join(libDir, 'seo-routes.ts'),
      `export const seoRoutes = [{ path: "/" }, { path: "/contact" }];`,
    );
    expect(discoverSeoRoutes(appPath)).toEqual(['/', '/contact']);
  });

  it('isExcludedFromSeoAudit marks /404', () => {
    expect(isExcludedFromSeoAudit('/404')).toBe(true);
    expect(isExcludedFromSeoAudit('/about')).toBe(false);
  });

  it('discoverAllAuditableRoutes unions seo-routes and page files', () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'menu.tsx'), `export default function Menu() { return <div />; }`);
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    expect(discoverPageRoutes(appPath)).toEqual(['/menu']);
    expect(discoverAllAuditableRoutes(appPath)).toEqual(['/', '/menu']);
  });

  it('runSeoAudit always uses source-only mode and never fetches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    const report = await runSeoAudit({ appId: 'test-app', appPath, includeSourceScan: false });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(report.auditMode).toBe('source-only');
    expect(report.htmlBaseUrl).toBeNull();
  });

  it('runSeoAudit flags missing helmet in source pages', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'about.tsx'), `export default function About() { return <div>About</div>; }`);
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/about" }];`);

    const report = await runSeoAudit({ appId: 'test-app', appPath, includeSourceScan: true });

    const about = report.pages.find(p => p.path === '/about');
    expect(about?.issues.some(i => i.code === 'missing-helmet')).toBe(true);
  });

  it('runSeoAudit flags page routes not in seo-routes registry', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'menu.tsx'), `export default function Menu() { return <div />; }`);
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    const report = await runSeoAudit({ appId: 'test-app', appPath, includeSourceScan: true });

    expect(report.routes).toEqual(['/', '/menu']);
    const menu = report.pages.find(p => p.path === '/menu');
    expect(menu?.layer).toBe('source');
    expect(menu?.issues.some(i => i.code === 'missing-seo-route')).toBe(true);
  });

  it('runSeoAudit excludes /404 from source routes', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(
      join(pagesDir, '_404.tsx'),
      `export default function NotFound() { return <div>404</div>; }`,
    );
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      join(libDir, 'seo-routes.ts'),
      `export const seoRoutes = [{ path: "/" }, { path: "/404" }];`,
    );

    const report = await runSeoAudit({ appId: 'test-app', appPath, includeSourceScan: true });

    expect(report.routes).toEqual(['/']);
    expect(report.pages.some(p => p.path === '/404')).toBe(false);
  });

  it('runSeoAudit flags orphaned registry routes without page files', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'index.tsx'), `export default function Home() { return <div />; }`);
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      join(libDir, 'seo-routes.ts'),
      `export const seoRoutes = [{ path: "/" }, { path: "/legacy" }];`,
    );

    const report = await runSeoAudit({ appId: 'test-app', appPath, includeSourceScan: false });

    const legacy = report.pages.find(p => p.path === '/legacy');
    expect(legacy?.issues.some(i => i.code === 'orphaned-seo-route')).toBe(true);
  });

  it('runSeoCheck merges strategy onto audit report', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'index.tsx'), `export default function Home() { return <div>Home</div>; }`);

    const report = await runSeoCheck({
      appId: 'test-check-app',
      appPath,
      includeSourceScan: false,
      useCachedAudit: false,
      strategyInput: {
        businessInfo: { name: 'Todo Co' },
        targetKeywords: ['todo app'],
      },
      appDisplayName: 'TodoApp',
    });

    expect(report.strategy?.businessInfo.name).toBe('Todo Co');
    expect(report.strategy?.targetKeywords).toEqual(['todo app']);
    expect(report.strategy?.analysisGuidance).toContain('Todo Co');
    expect(report.auditMode).toBe('source-only');
  });

  it('logPublishedSeoAudit scans source and logs audit-complete without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'index.tsx'), `import { Helmet } from '@dr.pogodin/react-helmet';\nexport default function Home() { return <Helmet><title>Home</title></Helmet>; }`);
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    const logger = { info: vi.fn(), warn: vi.fn() };

    await logPublishedSeoAudit('test-app', appPath, logger);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'seo.validation.audit-complete',
      expect.objectContaining({ appId: 'test-app' }),
    );
  });
});
