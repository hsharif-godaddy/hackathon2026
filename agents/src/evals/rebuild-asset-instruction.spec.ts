/**
 * Static eval (AIROBUILD-2104): the rebuild page prompt MUST instruct the agent
 * to use the imported source assets and not generate new images.
 *
 * This guards the regression we fixed: when the agent fabricates images instead
 * of using the scraped source. The deterministic-invocation work ensures the
 * agent reliably *receives* this prompt; this instruction is what keeps it from
 * generating images once it has it. If a future prompt edit strips or weakens
 * the directive, the build silently regresses to fabrication — this eval fails
 * before that lands.
 *
 * Mirrors `seo-generation.spec.ts`: a static, unit-level eval over the built
 * prompt (no LLM, no provider keys). The behavioral counterpart (agent actually
 * references /assets/ and makes zero media-generation calls) is the planned
 * LLM-driven eval and is verified manually via E2E for now.
 */
import { describe, expect, it } from 'vitest';

import { buildUserPrompt, isLikelyLogo } from '../agents/page-prompt/user-prompt-builder.js';
import type {
  AssetInfo,
  AssetManifest,
  PageContent,
  SiteMetadata,
  StylePreferences,
} from '../types/rebuild.js';

function imageAsset(overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    url: 'https://example.com/x.png',
    localPath: '.source-site/assets/images/x.png',
    type: 'image',
    sourcePages: ['https://example.com/'],
    ...overrides,
  } as AssetInfo;
}

describe('isLikelyLogo', () => {
  it('keeps a wide header wordmark the size bucket would miss (inHeader signal)', () => {
    expect(isLikelyLogo(imageAsset({
      localPath: '.source-site/assets/images/brand-mark.png',
      dimensions: { width: 1000, height: 250 },
      placement: { inHeader: true } as AssetInfo['placement'],
    }))).toBe(true);
  });

  it('keeps a logo-suitable small image', () => {
    expect(isLikelyLogo(imageAsset({ dimensions: { width: 200, height: 120 } }))).toBe(true);
  });

  it('keeps an image with "logo" in the path even when large (fallback branch)', () => {
    expect(isLikelyLogo(imageAsset({
      localPath: '.source-site/assets/images/site-logo.png',
      dimensions: { width: 1200, height: 800 },
    }))).toBe(true);
  });

  it('drops a body photo: not in header, not logo-suitable, no "logo" cue', () => {
    expect(isLikelyLogo(imageAsset({
      localPath: '.source-site/assets/images/hero.jpg',
      altText: 'team at work',
      dimensions: { width: 1200, height: 800 },
      placement: { inHeader: false } as AssetInfo['placement'],
    }))).toBe(false);
  });

  it('ignores non-image assets', () => {
    expect(isLikelyLogo(imageAsset({ type: 'font' }))).toBe(false);
  });
});

const siteMetadata: SiteMetadata = {
  sourceUrl: 'https://example.com',
  sitePurpose: 'Bakery',
  targetAudience: 'Local customers',
  brandVoice: 'Warm',
  designStyle: 'Cozy',
  colorPalette: { primary: ['#000'], secondary: [], accent: [] },
  typography: { headingFonts: ['Inter'], bodyFonts: ['Inter'], scale: [] },
  scrapedAt: '2024-01-01T00:00:00Z',
  version: '1',
};

const pageContent: PageContent = {
  url: 'https://example.com/about',
  slug: 'about',
  title: 'About',
  content: '<h1>About us</h1>',
  sanitizedContent: '<h1>About us</h1><p>We bake.</p>',
  structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
  metadata: { title: 'About' },
  scrapedAt: '2024-01-01T00:00:00Z',
};

const assetManifest: AssetManifest = {
  assets: [
    {
      url: 'https://example.com/hero.jpg',
      localPath: '.source-site/assets/images/hero.jpg',
      type: 'image',
      sourcePages: ['https://example.com/about'],
      dimensions: { width: 1200, height: 800 },
    },
  ],
  totalAssets: 1,
  byType: { image: 1, font: 0, icon: 0, other: 0 },
  generatedAt: '2024-01-01T00:00:00Z',
};

function buildPromptForDirection(designDirection: StylePreferences['designDirection']): string {
  return buildUserPrompt({
    siteMetadata,
    pageContent,
    stylePreferences: {
      designDirection,
      colorPreference: 'keep-original',
      typographyStyle: 'keep-original',
      layoutApproach: 'responsive',
    } as StylePreferences,
    assetManifest,
    isFirstPage: false,
    hasScreenshot: false,
  });
}

describe('rebuild page prompt — imported-asset directive', () => {
  // keep-similar is a faithful clone: the agent must reuse the scraped images
  // and not fabricate new ones (the AIROBUILD-2104 regression guard).
  describe('keep-similar (clone)', () => {
    const prompt = buildPromptForDirection('keep-similar');

    it('instructs the agent to use imported assets and not generate images', () => {
      expect(prompt).toContain('USE IMPORTED ASSETS');
      expect(prompt).toContain('DO NOT GENERATE NEW IMAGES');
      expect(prompt).toContain('Do NOT use the media tool');
    });
  });

  // modernize is a reimagining: keep the brand (logo) but use fresh imagery for
  // everything else, so it must NOT carry the clone's no-generate ban.
  describe('modernize (reimagine)', () => {
    const prompt = buildPromptForDirection('modernize');

    it('directs the agent toward fresh imagery rather than reusing source images', () => {
      expect(prompt).toContain('REIMAGINE WITH FRESH IMAGERY');
      expect(prompt).toContain('media tool');
      expect(prompt).not.toContain('DO NOT GENERATE NEW IMAGES');
    });

    it('still preserves the source brand/logo for recognizability', () => {
      expect(prompt.toLowerCase()).toContain('logo');
    });
  });

  it('surfaces imported asset paths as servable /assets/ URLs', () => {
    const prompt = buildPromptForDirection('keep-similar');
    expect(prompt).toContain('/assets/images/hero.jpg');
    // The source-site on-disk prefix must never leak into the prompt.
    expect(prompt).not.toContain('.source-site/assets/');
  });

  // Reimagine must not list source photos back to the agent (only the logo) — the
  // list itself tempts reuse regardless of the directive. Clone lists everything.
  describe('asset list scoping by direction', () => {
    const manifestWithLogo: AssetManifest = {
      assets: [
        {
          url: 'https://example.com/hero.jpg',
          localPath: '.source-site/assets/images/hero.jpg',
          type: 'image',
          sourcePages: ['https://example.com/about'],
          dimensions: { width: 1200, height: 800 },
        },
        {
          url: 'https://example.com/logo.png',
          localPath: '.source-site/assets/images/logo.png',
          type: 'image',
          sourcePages: ['https://example.com/about'],
          dimensions: { width: 200, height: 120 },
        },
      ],
      totalAssets: 2,
      byType: { image: 2, font: 0, icon: 0, other: 0 },
      generatedAt: '2024-01-01T00:00:00Z',
    };

    function promptWith(designDirection: StylePreferences['designDirection']): string {
      return buildUserPrompt({
        siteMetadata,
        pageContent,
        stylePreferences: {
          designDirection,
          colorPreference: 'keep-original',
          typographyStyle: 'keep-original',
          layoutApproach: 'responsive',
        } as StylePreferences,
        assetManifest: manifestWithLogo,
        isFirstPage: false,
        hasScreenshot: false,
      });
    }

    it('reimagine keeps the logo but omits source photos', () => {
      const prompt = promptWith('modernize');
      expect(prompt).toContain('/assets/images/logo.png');
      expect(prompt).not.toContain('/assets/images/hero.jpg');
    });

    it('clone lists both the logo and source photos', () => {
      const prompt = promptWith('keep-similar');
      expect(prompt).toContain('/assets/images/logo.png');
      expect(prompt).toContain('/assets/images/hero.jpg');
    });
  });
});
