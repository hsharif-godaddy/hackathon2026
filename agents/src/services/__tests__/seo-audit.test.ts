import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const recommendAeoSchemaTypesMock = vi.hoisted(() => vi.fn());

vi.mock('../aeo-schema-recommendations.js', () => ({
  recommendAeoSchemaTypes: recommendAeoSchemaTypesMock,
  extractRoutePageSignals: vi.fn((html: string, path: string) => ({
    path,
    title: 'My Page',
  })),
}));

import {
  parseSeoRoutePaths,
  discoverSeoRoutes,
  discoverPageRoutes,
  discoverAllAuditableRoutes,
  buildPublishedPageUrl,
  resolveHtmlAuditTarget,
  isExcludedFromSeoAudit,
  runSeoAudit,
  runSeoCheck,
  logPublishedSeoAudit,
} from '../seo-audit.js';

const FULL_HTML = `<!doctype html>
<html><head>
<title>My Page</title>
<meta name="description" content="desc">
<meta property="og:title" content="My Page">
<meta property="og:description" content="desc">
<meta property="og:image" content="https://example.com/img.png">
<meta property="og:url" content="https://example.com/about">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://example.com/img.png">
<link rel="canonical" href="https://example.com/about">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Example","url":"https://example.com/about"}</script>
</head><body><h1>Hi</h1></body></html>`;

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

  it('buildPublishedPageUrl joins base and route', () => {
    expect(buildPublishedPageUrl('https://example.com', '/about')).toBe('https://example.com/about');
    expect(buildPublishedPageUrl('https://example.com/', '/')).toBe('https://example.com');
  });

  it('buildPublishedPageUrl preserves preview share token query on subpaths', () => {
    const base = 'https://local.gasket.dev-godaddy.com:5004/?airoShareToken=abc123';
    expect(buildPublishedPageUrl(base, '/')).toBe(
      'https://local.gasket.dev-godaddy.com:5004/?airoShareToken=abc123',
    );
    expect(buildPublishedPageUrl(base, '/about')).toBe(
      'https://local.gasket.dev-godaddy.com:5004/about?airoShareToken=abc123',
    );
  });

  it('buildPublishedPageUrl preserves base pathname for sub-path mounts', () => {
    expect(buildPublishedPageUrl('https://host/app-xyz/', '/about')).toBe(
      'https://host/app-xyz/about',
    );
    expect(buildPublishedPageUrl('https://host/app-xyz', '/contact')).toBe(
      'https://host/app-xyz/contact',
    );
  });

  it('resolveHtmlAuditTarget prefers published over preview when isPublished', () => {
    expect(
      resolveHtmlAuditTarget('https://live.example.com', 'https://preview.example.com', true),
    ).toEqual({ baseUrl: 'https://live.example.com', htmlLayer: 'published' });
    expect(resolveHtmlAuditTarget(null, 'https://preview.example.com', true)).toBeNull();
    expect(resolveHtmlAuditTarget(null, 'https://preview.example.com', false)).toEqual({
      baseUrl: 'https://preview.example.com',
      htmlLayer: 'preview',
    });
    expect(resolveHtmlAuditTarget('', '  ', false)).toBeNull();
  });

  it('resolveHtmlAuditTarget uses preview when published URL exists but site is not published', () => {
    expect(
      resolveHtmlAuditTarget('https://live.example.com', 'https://preview.example.com', false),
    ).toEqual({ baseUrl: 'https://preview.example.com', htmlLayer: 'preview' });
    expect(resolveHtmlAuditTarget('https://live.example.com', null, false)).toBeNull();
  });

  it('runSeoAudit audits multiple published routes', async () => {
    const fetchMock = vi.fn().mockImplementation(function (input: RequestInfo | URL) {
      const url = String(input);
      const html = FULL_HTML.replace(/https:\/\/example\.com\/about/g, url.replace(/\/$/, '') || url);
      return Promise.resolve(
        new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      join(libDir, 'seo-routes.ts'),
      `export const seoRoutes = [{ path: "/" }, { path: "/about" }];`,
    );

    const report = await runSeoAudit({
      appId: 'test-app',
      appPath,
      publishedUrl: 'https://example.com',
      isPublished: true,
      includeSourceScan: false,
    });

    expect(report.pages).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(report.auditMode).toBe('published');
    expect(report.summary.issueCount).toBe(0);
  });

  it('runSeoAudit uses previewUrl when publishedUrl is missing', async () => {
    const fetchMock = vi.fn().mockImplementation(function (input: RequestInfo | URL) {
      const url = String(input);
      const html = FULL_HTML.replace(/https:\/\/example\.com\/about/g, url.replace(/\/$/, '') || url);
      return Promise.resolve(
        new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    const report = await runSeoAudit({
      appId: 'test-app',
      appPath,
      publishedUrl: null,
      previewUrl: 'https://preview.example.com',
      includeSourceScan: false,
    });

    expect(report.auditMode).toBe('preview');
    expect(report.htmlBaseUrl).toBe('https://preview.example.com');
    expect(report.pages[0]?.layer).toBe('preview');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('runSeoAudit uses preview when published URL exists but isPublished is false', async () => {
    const fetchMock = vi.fn().mockImplementation(function (input: RequestInfo | URL) {
      const url = String(input);
      const html = FULL_HTML.replace(/https:\/\/example\.com\/about/g, url.replace(/\/$/, '') || url);
      return Promise.resolve(
        new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    const report = await runSeoAudit({
      appId: 'test-app',
      appPath,
      publishedUrl: 'https://live.example.com',
      previewUrl: 'https://preview.example.com',
      isPublished: false,
      includeSourceScan: false,
    });

    expect(report.auditMode).toBe('preview');
    expect(report.htmlBaseUrl).toBe('https://preview.example.com');
    expect(report.publishedBaseUrl).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('preview.example.com');
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

  it('runSeoAudit html-audits page routes not in seo-routes and flags registry gap', async () => {
    const fetchMock = vi.fn().mockImplementation(function () { return Promise.resolve(
        new Response('<html><head></head><body></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ); },
    );
    vi.stubGlobal('fetch', fetchMock);

    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'menu.tsx'), `export default function Menu() { return <div />; }`);
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    const report = await runSeoAudit({
      appId: 'test-app',
      appPath,
      previewUrl: 'https://preview.example.com',
      includeSourceScan: false,
    });

    expect(report.routes).toEqual(['/', '/menu']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const menu = report.pages.find(p => p.path === '/menu');
    expect(menu?.layer).toBe('preview');
    expect(menu?.issues.some(i => i.code === 'missing-title')).toBe(true);
    expect(menu?.issues.some(i => i.code === 'missing-seo-route')).toBe(true);
  });

  it('runSeoAudit excludes /404 from source and html routes', async () => {
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

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(FULL_HTML, { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const report = await runSeoAudit({
      appId: 'test-app',
      appPath,
      publishedUrl: 'https://example.com',
      isPublished: true,
      includeSourceScan: true,
    });

    expect(report.routes).toEqual(['/']);
    expect(report.pages.some(p => p.path === '/404')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runSeoAudit flags missing helmet in source pages', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'about.tsx'), `export default function About() { return <div>About</div>; }`);
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/about" }];`);

    const report = await runSeoAudit({
      appId: 'test-app',
      appPath,
      publishedUrl: null,
      includeSourceScan: true,
    });

    expect(report.auditMode).toBe('source-only');
    const about = report.pages.find(p => p.path === '/about');
    expect(about?.issues.some(i => i.code === 'missing-helmet')).toBe(true);
  });

  it('runSeoCheck merges strategy onto audit report', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const pagesDir = join(appPath, 'src', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(join(pagesDir, 'index.tsx'), `export default function Home() { return <div>Home</div>; }`);

    const report = await runSeoCheck({
      appId: 'test-check-app',
      appPath,
      publishedUrl: null,
      previewUrl: null,
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

    const report = await runSeoAudit({
      appId: 'test-app',
      appPath,
      publishedUrl: null,
      includeSourceScan: false,
    });

    const legacy = report.pages.find(p => p.path === '/legacy');
    expect(legacy?.issues.some(i => i.code === 'orphaned-seo-route')).toBe(true);
  });

  it('runSeoAudit attaches LLM schema recommendations when executionContext is provided', async () => {
    recommendAeoSchemaTypesMock.mockResolvedValue({
      '/': { types: ['WebSite', 'Organization'], fields: ['name', 'url'] },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(FULL_HTML, { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    const report = await runSeoAudit({
      appId: 'test-app',
      appPath,
      publishedUrl: 'https://example.com',
      isPublished: true,
      includeSourceScan: false,
      executionContext: { metadata: { appId: 'test-app', subscriptionId: 'sub-1' } },
    });

    expect(recommendAeoSchemaTypesMock).toHaveBeenCalled();
    expect(report.schemaAeoByRoute).toEqual({
      '/': { types: ['WebSite', 'Organization'], fields: ['name', 'url'] },
    });
  });

  it('logPublishedSeoAudit fetches published routes and logs audit-complete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(FULL_HTML, { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const appPath = mkdtempSync(join(tmpdir(), 'seo-app-'));
    const libDir = join(appPath, 'src', 'lib');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'seo-routes.ts'), `export const seoRoutes = [{ path: "/" }];`);

    const logger = { info: vi.fn(), warn: vi.fn() };

    await logPublishedSeoAudit('test-app', appPath, 'https://live.example.com', logger);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('live.example.com');
    expect(logger.info).toHaveBeenCalledWith(
      'seo.validation.audit-complete',
      expect.objectContaining({ appId: 'test-app' }),
    );
  });
});
