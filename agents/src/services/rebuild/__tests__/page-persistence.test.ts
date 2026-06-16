import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => mockLogger },
}));

import { extractNavigationFromHtml, PagePersistenceService } from '../page-persistence.js';

describe('extractNavigationFromHtml', () => {
  it('returns [] when html is undefined or has no <nav>', () => {
    expect(extractNavigationFromHtml(undefined, 'https://example.com/')).toEqual([]);
    expect(extractNavigationFromHtml('<html><body>no nav</body></html>', 'https://example.com/')).toEqual([]);
  });

  it('extracts links from the first <nav> block', () => {
    const html = `
      <nav>
        <a href="/about">About us</a>
        <a href="/services">Services</a>
        <a href="/contact">Contact</a>
      </nav>
      <nav><a href="/footer-nav">Footer</a></nav>
    `;
    const items = extractNavigationFromHtml(html, 'https://example.com/');
    expect(items).toEqual([
      { label: 'About us', url: '/about', isExternal: false },
      { label: 'Services', url: '/services', isExternal: false },
      { label: 'Contact', url: '/contact', isExternal: false },
    ]);
  });

  it('drops fragment, empty, and self-/ links', () => {
    const html = `
      <nav>
        <a href="#top">Top</a>
        <a href="#section">Section</a>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    `;
    expect(extractNavigationFromHtml(html, 'https://example.com/')).toEqual([
      { label: 'About', url: '/about', isExternal: false },
    ]);
  });

  it('marks cross-origin links as external and keeps their full URL', () => {
    const html = `
      <nav>
        <a href="https://other.com/page">External</a>
        <a href="/internal">Internal</a>
      </nav>
    `;
    expect(extractNavigationFromHtml(html, 'https://example.com/')).toEqual([
      { label: 'External', url: 'https://other.com/page', isExternal: true },
      { label: 'Internal', url: '/internal', isExternal: false },
    ]);
  });

  it('collapses internal hrefs to pathname (strips trailing slash, keeps "/" only as falsy → drop)', () => {
    const html = `
      <nav>
        <a href="https://example.com/work/">Work</a>
        <a href="https://example.com/about-us">About</a>
      </nav>
    `;
    expect(extractNavigationFromHtml(html, 'https://example.com/')).toEqual([
      { label: 'Work', url: '/work', isExternal: false },
      { label: 'About', url: '/about-us', isExternal: false },
    ]);
  });

  it('skips items whose visible text is empty or longer than 50 chars', () => {
    const longText = 'a'.repeat(60);
    const html = `
      <nav>
        <a href="/empty"></a>
        <a href="/long">${longText}</a>
        <a href="/ok">OK</a>
      </nav>
    `;
    expect(extractNavigationFromHtml(html, 'https://example.com/')).toEqual([
      { label: 'OK', url: '/ok', isExternal: false },
    ]);
  });

  it('dedupes by resolved path (internal) and by raw href (external)', () => {
    const html = `
      <nav>
        <a href="/about">About</a>
        <a href="/about">About again</a>
        <a href="https://other.com/x">Other</a>
        <a href="https://other.com/x">Other again</a>
      </nav>
    `;
    expect(extractNavigationFromHtml(html, 'https://example.com/')).toEqual([
      { label: 'About', url: '/about', isExternal: false },
      { label: 'Other', url: 'https://other.com/x', isExternal: true },
    ]);
  });

  it('caps output at 15 items', () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join('');
    const html = `<nav>${links}</nav>`;
    expect(extractNavigationFromHtml(html, 'https://example.com/')).toHaveLength(15);
  });

  it('returns the first <nav> with non-empty links and ignores subsequent <nav> blocks', () => {
    const html = `
      <nav><a href="#fragment">No links here</a></nav>
      <nav><a href="/real">Real link</a></nav>
    `;
    expect(extractNavigationFromHtml(html, 'https://example.com/')).toEqual([
      { label: 'Real link', url: '/real', isExternal: false },
    ]);
  });
});

// Atlas-only persistence behavior — covers the gap that the orchestrator-level
// round-trip test in RebuildOrchestrationService.test.ts doesn't exercise
// (it calls savePage with useAtlas=false because the test service has no Atlas
// option set). These tests hit PagePersistenceService.savePage directly with
// useAtlas=true to lock in the Atlas-only attachments.
describe('PagePersistenceService.savePage (Atlas branch)', () => {
  let appDir: string;
  let sourceSiteDir: string;
  let persistence: PagePersistenceService;

  beforeEach(async () => {
    appDir = await mkdtemp(path.join(tmpdir(), 'page-persistence-atlas-'));
    sourceSiteDir = path.join(appDir, '.source-site');
    await mkdir(path.join(sourceSiteDir, 'pages'), { recursive: true });
    await mkdir(path.join(sourceSiteDir, 'screenshots'), { recursive: true });
    persistence = new PagePersistenceService(sourceSiteDir);
    mockLogger.warn.mockReset();
    mockLogger.debug.mockReset();
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  it('attaches detected interactivePatterns to the persisted JSON when useAtlas=true', async () => {
    const html = '<div class="swiper-container"><div class="swiper-slide">slide</div></div>';
    await persistence.savePage(
      { url: 'https://example.com/', html, sanitizedContent: 'Slideshow demo' },
      'homepage',
      [],
      true,
    );
    const saved = JSON.parse(await readFile(path.join(sourceSiteDir, 'pages', 'homepage.json'), 'utf-8'));
    expect(saved.structure.interactivePatterns).toBeDefined();
    expect(saved.structure.interactivePatterns[0]).toMatchObject({ type: 'carousel' });
  });

  it('does NOT attach interactivePatterns when useAtlas=false even if html has carousel markers', async () => {
    const html = '<div class="swiper-container"><div class="swiper-slide">slide</div></div>';
    await persistence.savePage(
      { url: 'https://example.com/', html, sanitizedContent: 'Slideshow demo' },
      'homepage',
      [],
      false,
    );
    const saved = JSON.parse(await readFile(path.join(sourceSiteDir, 'pages', 'homepage.json'), 'utf-8'));
    expect(saved.structure.interactivePatterns).toBeUndefined();
  });

  it('attaches forms to the persisted JSON when useAtlas=true and forms supplied', async () => {
    const forms = [
      {
        method: 'post' as const,
        action: '/subscribe',
        fields: [{ type: 'email', name: 'email', required: true }],
        submitButton: { text: 'Subscribe' },
      },
    ];
    await persistence.savePage(
      { url: 'https://example.com/', sanitizedContent: 'Newsletter', html: '<p>hi</p>', forms },
      'homepage',
      [],
      true,
    );
    const saved = JSON.parse(await readFile(path.join(sourceSiteDir, 'pages', 'homepage.json'), 'utf-8'));
    expect(saved.structure.forms).toEqual(forms);
  });

  it('attaches contentLinks to the persisted JSON when useAtlas=true and links supplied', async () => {
    const contentLinks = [
      {
        label: 'Menu PDF',
        url: 'https://example.com/files/menu.pdf',
        isExternal: false,
      },
    ];
    await persistence.savePage(
      { url: 'https://example.com/cakes', sanitizedContent: 'Cakes', html: '<p>hi</p>', contentLinks },
      'cakes',
      [],
      true,
    );
    const saved = JSON.parse(await readFile(path.join(sourceSiteDir, 'pages', 'cakes.json'), 'utf-8'));
    expect(saved.structure.contentLinks).toEqual(contentLinks);
  });

  it('drops supplied contentLinks when useAtlas=false', async () => {
    const contentLinks = [
      {
        label: 'Menu PDF',
        url: 'https://example.com/files/menu.pdf',
        isExternal: false,
      },
    ];
    await persistence.savePage(
      { url: 'https://example.com/cakes', sanitizedContent: 'Cakes', html: '<p>hi</p>', contentLinks },
      'cakes',
      [],
      false,
    );
    const saved = JSON.parse(await readFile(path.join(sourceSiteDir, 'pages', 'cakes.json'), 'utf-8'));
    expect(saved.structure.contentLinks).toBeUndefined();
  });

  it('drops supplied forms when useAtlas=false (legacy path never attaches structured forms)', async () => {
    const forms = [
      {
        method: 'get' as const,
        fields: [{ type: 'email', required: true }],
      },
    ];
    await persistence.savePage(
      { url: 'https://example.com/', sanitizedContent: 'page', html: '<p>x</p>', forms },
      'homepage',
      [],
      false,
    );
    const saved = JSON.parse(await readFile(path.join(sourceSiteDir, 'pages', 'homepage.json'), 'utf-8'));
    expect(saved.structure.forms).toBeUndefined();
  });

  it('warns rebuild-orchestration.atlas-missing-html when useAtlas=true and html is absent', async () => {
    await persistence.savePage(
      { url: 'https://example.com/', sanitizedContent: 'no html' },
      'homepage',
      [],
      true,
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'rebuild-orchestration.atlas-missing-html',
      expect.objectContaining({ url: 'https://example.com/', slug: 'homepage' }),
    );
  });

  it('does NOT warn atlas-missing-html on the legacy path even with no html', async () => {
    await persistence.savePage(
      { url: 'https://example.com/', sanitizedContent: 'no html' },
      'homepage',
      [],
      false,
    );
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'rebuild-orchestration.atlas-missing-html',
      expect.anything(),
    );
  });

  it('persists full page metadata (OG tags, description, canonical, keywords) when provided', async () => {
    const metadata = {
      title: 'About Us',
      description: 'Learn about our company',
      ogTitle: 'About | Example',
      ogDescription: 'Our story',
      ogImage: 'https://example.com/about-og.jpg',
      canonicalUrl: 'https://example.com/about',
      keywords: ['about', 'company'],
    };
    await persistence.savePage(
      { url: 'https://example.com/about', sanitizedContent: '<h1>About Us</h1>', html: '<p>hi</p>', metadata },
      'about',
      [],
      true,
    );
    const saved = JSON.parse(await readFile(path.join(sourceSiteDir, 'pages', 'about.json'), 'utf-8'));
    expect(saved.metadata).toEqual(metadata);
  });

  it('falls back to title-only metadata when no metadata provided (backward compat)', async () => {
    await persistence.savePage(
      { url: 'https://example.com/', sanitizedContent: '<h1>Home Page</h1>', html: '<p>hi</p>' },
      'homepage',
      [],
      true,
    );
    const saved = JSON.parse(await readFile(path.join(sourceSiteDir, 'pages', 'homepage.json'), 'utf-8'));
    expect(saved.metadata).toEqual({ title: 'Home Page' });
  });
});
