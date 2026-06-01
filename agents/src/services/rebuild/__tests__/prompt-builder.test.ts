import { describe, expect, it } from 'vitest';

import type { AssetManifest, PageContent, SiteMetadata, StylePreferences } from '../../../types/rebuild.js';
import { buildPageSpec } from '../prompt-builder.js';

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
});
