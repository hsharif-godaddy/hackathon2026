import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AssetManifest,
  PageContent,
  RebuildWorkflowState,
  SiteMetadata,
  SourceSiteData,
  StylePreferences,
} from '../../../types/rebuild.js';
import { resolvePageTitle } from '../../../utils/rebuild-utils.js';
import type { PagePersistenceService } from '../page-persistence.js';

// Mock the two classes buildPage news up so the producing seam runs without an
// LLM call or real asset I/O. `function` constructors (not arrow/object) so the
// `new` in prompt-builder works under vitest's ESM mock.
const generateMock = vi.fn(async () => 'GENERATED PROMPT');
vi.mock('../../../agents/page-prompt-agent.js', () => ({
  PagePromptAgent: function () {
    return {
      initialize: vi.fn(async () => undefined),
      generate: generateMock,
      cleanup: vi.fn(async () => undefined),
    };
  },
}));

const { mockFindById } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
}));
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function appRepository(this: unknown) {
    return { findById: mockFindById };
  }),
}));

const analyzePageAssetsMock = vi.fn();
vi.mock('../../AssetProcessingService.js', () => ({
  AssetProcessingService: function () {
    return { analyzePageAssets: analyzePageAssetsMock };
  },
}));

const applyRebuildTypographyMock = vi.fn(async () => ({ applied: true }));
vi.mock('../typography.js', () => ({
  applyRebuildTypography: (...args: unknown[]) => applyRebuildTypographyMock(...args),
}));

import { buildPageSpec, RebuildPromptBuilder } from '../prompt-builder.js';

const baseSiteMetadata: SiteMetadata = {
  sourceUrl: 'https://example.com',
  sitePurpose: 'Business site',
  targetAudience: 'Small businesses',
  brandVoice: 'Professional',
  designStyle: 'Modern',
  colorPalette: { primary: ['#000'], secondary: [], accent: [] },
  typography: { headingFonts: ['Inter'], bodyFonts: ['Roboto'] },
  scrapedAt: '2024-01-01T00:00:00Z',
  version: '1',
};

const baseStylePreferences: StylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
};

const emptyAssetManifest: AssetManifest = {
  assets: [],
  totalAssets: 0,
  byType: { image: 0, font: 0, icon: 0, other: 0 },
  generatedAt: '2024-01-01T00:00:00Z',
};

describe('buildPageSpec', () => {
  it('includes page metadata in the spec when present on PageContent', () => {
    const pageContent: PageContent = {
      url: 'https://example.com/about',
      slug: 'about',
      title: 'About Us',
      content: '<h1>About</h1>',
      sanitizedContent: '<h1>About</h1>',
      structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
      metadata: {
        title: 'About Us',
        description: 'Learn about our company',
        ogTitle: 'About | Example',
        ogDescription: 'Our story',
        ogImage: 'https://example.com/og.jpg',
        canonicalUrl: 'https://example.com/about',
        keywords: ['about', 'company'],
      },
      scrapedAt: '2024-01-01T00:00:00Z',
    };

    const spec = buildPageSpec('about', pageContent, baseSiteMetadata, baseStylePreferences, emptyAssetManifest, false);

    expect(spec.page.metadata).toEqual({
      title: 'About Us',
      description: 'Learn about our company',
      ogTitle: 'About | Example',
      ogDescription: 'Our story',
      ogImage: 'https://example.com/og.jpg',
      canonicalUrl: 'https://example.com/about',
      keywords: ['about', 'company'],
    });
  });

  it('includes title-only metadata when no extra fields present', () => {
    const pageContent: PageContent = {
      url: 'https://example.com/',
      slug: 'homepage',
      title: 'Home',
      content: '<h1>Home</h1>',
      sanitizedContent: '<h1>Home</h1>',
      structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
      metadata: { title: 'Home' },
      scrapedAt: '2024-01-01T00:00:00Z',
    };

    const spec = buildPageSpec('homepage', pageContent, baseSiteMetadata, baseStylePreferences, emptyAssetManifest, true);

    expect(spec.page.metadata).toEqual({ title: 'Home' });
  });

  it('includes form id and className in spec forms', () => {
    const pageContent: PageContent = {
      url: 'https://example.com/contact',
      slug: 'contact',
      title: 'Contact',
      content: '<h1>Contact</h1>',
      sanitizedContent: '<h1>Contact</h1>',
      structure: {
        hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [],
        forms: [{
          method: 'post',
          action: '/submit',
          id: 'contact-form',
          className: 'main-form wide',
          fields: [{ type: 'email', name: 'email', required: true }],
          submitButton: { text: 'Send' },
        }],
      },
      metadata: { title: 'Contact' },
      scrapedAt: '2024-01-01T00:00:00Z',
    };

    const spec = buildPageSpec('contact', pageContent, baseSiteMetadata, baseStylePreferences, emptyAssetManifest, false);

    expect(spec.forms[0]).toMatchObject({ id: 'contact-form', className: 'main-form wide' });
  });

  it('includes contentLinks in the spec when present on PageContent', () => {
    const pageContent: PageContent = {
      url: 'https://example.com/cakes',
      slug: 'cakes',
      title: 'Cakes',
      content: '<h1>Cakes</h1>',
      sanitizedContent: '<h1>Cakes</h1>',
      structure: {
        hasHeader: true,
        hasFooter: true,
        hasSidebar: false,
        sections: [],
        navigation: [],
        contentLinks: [
          {
            label: 'Menu PDF',
            url: 'https://example.com/files/menu.pdf',
            isExternal: false,
          },
        ],
      },
      metadata: { title: 'Cakes' },
      scrapedAt: '2024-01-01T00:00:00Z',
    };

    const spec = buildPageSpec('cakes', pageContent, baseSiteMetadata, baseStylePreferences, emptyAssetManifest, false);

    expect(spec.contentLinks).toEqual([
      {
        label: 'Menu PDF',
        url: 'https://example.com/files/menu.pdf',
        isExternal: false,
      },
    ]);
  });

  describe('favicon wiring', () => {
    const pageContent: PageContent = {
      url: 'https://example.com/',
      slug: 'homepage',
      title: 'Home',
      content: '<h1>Home</h1>',
      sanitizedContent: '<h1>Home</h1>',
      structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
      metadata: { title: 'Home' },
      scrapedAt: '2024-01-01T00:00:00Z',
    };

    it('omits site.favicon when the source metadata has none', () => {
      const spec = buildPageSpec('homepage', pageContent, baseSiteMetadata, baseStylePreferences, emptyAssetManifest, true);
      expect(spec.site.favicon).toBeUndefined();
    });

    it('emits a favicon whose href resolves to the downloaded asset public path', () => {
      const siteMetadata: SiteMetadata = {
        ...baseSiteMetadata,
        favicon: { url: 'https://example.com/favicon.png', rel: 'icon', sizes: '32x32', mimeType: 'image/png' },
      };
      const manifest: AssetManifest = {
        ...emptyAssetManifest,
        assets: [{
          url: 'https://example.com/favicon.png',
          localPath: '.source-site/assets/icons/favicon.png',
          type: 'icon',
          sourcePages: ['https://example.com/'],
        }],
        totalAssets: 1,
        byType: { image: 0, font: 0, icon: 1, other: 0 },
      };

      const spec = buildPageSpec('homepage', pageContent, siteMetadata, baseStylePreferences, manifest, true);

      expect(spec.site.favicon).toEqual({
        href: '/assets/icons/favicon.png',
        rel: 'icon',
        sizes: '32x32',
        mimeType: 'image/png',
      });
    });

    it('falls back to the source URL when no downloaded asset matches the favicon', () => {
      const siteMetadata: SiteMetadata = {
        ...baseSiteMetadata,
        favicon: { url: 'https://example.com/favicon.ico' },
      };

      const spec = buildPageSpec('homepage', pageContent, siteMetadata, baseStylePreferences, emptyAssetManifest, true);

      expect(spec.site.favicon).toEqual({ href: 'https://example.com/favicon.ico' });
    });
  });
});

describe('RebuildPromptBuilder.buildPage — BuildPageResult fields', () => {
  it('surfaces sourceUrl, resolved pageTitle, and image-specific count', async () => {
    const pageContent: PageContent = {
      url: 'https://example.com/about',
      slug: 'about',
      title: 'About Us',
      content: '<h1>About</h1>',
      sanitizedContent: 'About',
      structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
      metadata: { title: 'About Us' },
      scrapedAt: '2024-01-01T00:00:00Z',
    };

    const sourceSiteData = {
      metadata: baseSiteMetadata,
      pages: { about: pageContent },
      assets: [],
      sitemap: { pages: [{ slug: 'about', url: 'https://example.com/about', scraped: true, source: 'crawl' }] },
    } as unknown as SourceSiteData;

    // 3 images + 1 font — imageCount must reflect byType.image (3), not total assets (4).
    analyzePageAssetsMock.mockResolvedValue({
      pageAssets: [
        { type: 'image', url: 'a.jpg', localPath: '/a.jpg' },
        { type: 'image', url: 'b.jpg', localPath: '/b.jpg' },
        { type: 'image', url: 'c.jpg', localPath: '/c.jpg' },
        { type: 'font', url: 'f.woff', localPath: '/f.woff' },
      ],
      analyzedImageCount: 3,
    });

    const persistence = {
      loadSourceSiteData: vi.fn(async () => sourceSiteData),
    } as unknown as PagePersistenceService;

    const builder = new RebuildPromptBuilder('/app', '/app/.source-site', persistence, false);

    const state = {
      stylePreferences: baseStylePreferences,
      pagesBuilt: ['homepage'], // non-empty → not first page, skips screenshot load
    } as unknown as RebuildWorkflowState;

    const result = await builder.buildPage('app123', 'about', state);

    expect(result.sourceUrl).toBe('https://example.com/about');
    expect(result.pageTitle).toBe(resolvePageTitle('About Us', 'about'));
    expect(result.imageCount).toBe(3);
    expect(result.prompt).toBe('GENERATED PROMPT');
  });
});

describe('RebuildPromptBuilder.buildPage — rebuild Langfuse tagging (Leg A)', () => {
  const pageContent: PageContent = {
    url: 'https://example.com/',
    slug: 'homepage',
    title: 'Home',
    content: '<h1>Home</h1>',
    sanitizedContent: 'Home',
    structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
    metadata: { title: 'Home' },
    scrapedAt: '2024-01-01T00:00:00Z',
  };

  const sourceSiteData = {
    metadata: baseSiteMetadata,
    pages: { homepage: pageContent },
    assets: [],
    sitemap: { pages: [{ slug: 'homepage', url: 'https://example.com/', scraped: true, source: 'crawl' }] },
  } as unknown as SourceSiteData;

  beforeEach(() => {
    generateMock.mockClear();
    applyRebuildTypographyMock.mockClear();
    analyzePageAssetsMock.mockResolvedValue({ pageAssets: [], analyzedImageCount: 0 });
    mockFindById.mockReturnValue({
      subscriptionId: 'sub-123',
      customerId: 'cust-456',
    });
  });

  it('applies rebuild typography before generating the homepage prompt', async function applyTypographyFirst() {
    const persistence = {
      loadSourceSiteData: vi.fn(async () => sourceSiteData),
    } as unknown as PagePersistenceService;

    const builder = new RebuildPromptBuilder('/app', '/app/.source-site', persistence, false);
    const state = {
      stylePreferences: baseStylePreferences,
      pagesBuilt: [],
    } as unknown as RebuildWorkflowState;

    await builder.buildPage('app123', 'homepage', state);

    expect(applyRebuildTypographyMock).toHaveBeenCalledOnce();
    expect(applyRebuildTypographyMock).toHaveBeenCalledWith(
      'app123',
      baseSiteMetadata.typography,
      baseStylePreferences,
      true,
    );
    expect(generateMock).toHaveBeenCalledOnce();
    expect(applyRebuildTypographyMock.mock.invocationCallOrder[0]).toBeLessThan(
      generateMock.mock.invocationCallOrder[0]!,
    );
  });

  it('threads isRebuildFlow executionContext into PagePromptAgent.generate', async () => {
    const persistence = {
      loadSourceSiteData: vi.fn(async () => sourceSiteData),
    } as unknown as PagePersistenceService;

    const builder = new RebuildPromptBuilder('/app', '/app/.source-site', persistence, false);
    const state = {
      stylePreferences: baseStylePreferences,
      pagesBuilt: [],
    } as unknown as RebuildWorkflowState;

    await builder.buildPage('app123', 'homepage', state);

    expect(generateMock).toHaveBeenCalledOnce();
    expect(generateMock.mock.calls[0][6]).toEqual({
      metadata: {
        appId: 'app123',
        isRebuildFlow: true,
        subscriptionId: 'sub-123',
        customerId: 'cust-456',
      },
    });
  });
});
