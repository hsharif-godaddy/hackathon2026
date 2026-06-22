/**
 * Static eval (AIROBUILD-2104 / AIROBUILD-2715): the rebuild page prompt MUST
 * instruct the agent correctly based on the bring-over toggle state.
 *
 * Two regression classes guarded here:
 * 1. (2104) When the agent fabricates images instead of reusing the scraped
 *    source — guarded by the USE-IMPORTED-ASSETS directive.
 * 2. (2715) When a bring-over toggle is flipped, the prompt must shift the
 *    directive AND the visible asset list to match — guarded by the four
 *    toggle-dimension assertions at the bottom of this file.
 *
 * All assertions are deterministic over the built prompt string (no LLM, no
 * provider keys). The behavioral counterpart (agent actually references
 * /assets/ and makes zero media calls) is verified manually via E2E for now.
 */
import { describe, expect, it } from 'vitest';

import { buildUserPrompt, isLikelyLogo, selectPromptAssets } from '../agents/page-prompt/user-prompt-builder.js';
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

/**
 * Build a prompt with explicit bring-over flags. The four boolean flags are the
 * source of truth for asset/directive behavior as of AIROBUILD-2715; passing
 * only `designDirection` is no longer sufficient.
 */
function buildPromptWith(overrides: Partial<StylePreferences>): string {
  return buildUserPrompt({
    siteMetadata,
    pageContent,
    stylePreferences: {
      designDirection: 'keep-similar',
      colorPreference: 'keep-original',
      typographyStyle: 'keep-original',
      layoutApproach: 'responsive',
      keepLogo: true,
      keepSourceImages: true,
      ...overrides,
    } as StylePreferences,
    assetManifest,
    isFirstPage: false,
    hasScreenshot: false,
  });
}

/** Convenience: build prompt from a direction preset (mirrors the old API). */
function buildPromptForDirection(designDirection: StylePreferences['designDirection']): string {
  const isClone = designDirection === 'keep-similar';
  return buildPromptWith({
    designDirection,
    keepLogo: true,
    keepSourceImages: isClone,
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
      const isClone = designDirection === 'keep-similar';
      return buildUserPrompt({
        siteMetadata,
        pageContent,
        stylePreferences: {
          designDirection,
          colorPreference: 'keep-original',
          typographyStyle: 'keep-original',
          layoutApproach: 'responsive',
          keepLogo: true,
          keepSourceImages: isClone,
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

// ---------------------------------------------------------------------------
// AIROBUILD-2715 bring-over toggle eval dimensions
// ---------------------------------------------------------------------------
// Each dimension asserts the deterministic lever output (prompt text, asset
// list) flips correctly when a single toggle changes. Tests run offline — no
// LLM calls, no provider keys.

const twoAssetManifest: AssetManifest = {
  assets: [
    {
      url: 'https://example.com/logo.png',
      localPath: '.source-site/assets/images/logo.png',
      type: 'image',
      sourcePages: ['https://example.com/'],
      dimensions: { width: 200, height: 120 },
    },
    {
      url: 'https://example.com/hero.jpg',
      localPath: '.source-site/assets/images/hero.jpg',
      type: 'image',
      sourcePages: ['https://example.com/'],
      dimensions: { width: 1200, height: 800 },
    },
  ],
  totalAssets: 2,
  byType: { image: 2, font: 0, icon: 0, other: 0 },
  generatedAt: '2024-01-01T00:00:00Z',
};

// Non-null: twoAssetManifest is constructed above with exactly two assets;
// indexed access is AssetInfo | undefined under noUncheckedIndexedAccess.
const logoAsset = twoAssetManifest.assets[0]!;
const heroAsset = twoAssetManifest.assets[1]!;

describe('eval dimension: logo-survival (AIROBUILD-2715)', () => {
  it('keepLogo: true — logo is offered to the agent (present in asset list)', () => {
    const selected = selectPromptAssets([logoAsset, heroAsset], {
      designDirection: 'modernize',
      colorPreference: 'suggest-new',
      typographyStyle: 'modern',
      layoutApproach: 'responsive',
      keepLogo: true,
      keepSourceImages: false,
    } as StylePreferences);
    expect(selected.some((a) => isLikelyLogo(a))).toBe(true);
    expect(selected).toContain(logoAsset);
  });

  it('keepLogo: false — logo is excluded from asset list', () => {
    const selected = selectPromptAssets([logoAsset, heroAsset], {
      designDirection: 'modernize',
      colorPreference: 'suggest-new',
      typographyStyle: 'modern',
      layoutApproach: 'responsive',
      keepLogo: false,
      keepSourceImages: false,
    } as StylePreferences);
    expect(selected.some((a) => isLikelyLogo(a))).toBe(false);
    expect(selected).not.toContain(logoAsset);
  });

  it('keepLogo: true prompt — directive references logo path', () => {
    const prompt = buildUserPrompt({
      siteMetadata,
      pageContent,
      stylePreferences: {
        designDirection: 'modernize',
        colorPreference: 'suggest-new',
        typographyStyle: 'modern',
        layoutApproach: 'responsive',
        keepLogo: true,
        keepSourceImages: false,
      } as StylePreferences,
      assetManifest: twoAssetManifest,
      isFirstPage: false,
      hasScreenshot: false,
    });
    expect(prompt).toContain('/assets/images/logo.png');
    expect(prompt).not.toContain('/assets/images/hero.jpg');
  });

  it('keepLogo: false prompt — no source assets referenced, only fresh imagery', () => {
    const prompt = buildUserPrompt({
      siteMetadata,
      pageContent,
      stylePreferences: {
        designDirection: 'modernize',
        colorPreference: 'suggest-new',
        typographyStyle: 'modern',
        layoutApproach: 'responsive',
        keepLogo: false,
        keepSourceImages: false,
      } as StylePreferences,
      assetManifest: twoAssetManifest,
      isFirstPage: false,
      hasScreenshot: false,
    });
    expect(prompt).toContain('FRESH IMAGERY, NO SOURCE BRAND ASSETS');
    expect(prompt).not.toContain('/assets/images/logo.png');
    expect(prompt).not.toContain('/assets/images/hero.jpg');
  });
});

describe('eval dimension: source-image-usage (AIROBUILD-2715)', () => {
  it('keepSourceImages: true — source photos present in asset list', () => {
    const selected = selectPromptAssets([logoAsset, heroAsset], {
      designDirection: 'keep-similar',
      colorPreference: 'keep-original',
      typographyStyle: 'keep-original',
      layoutApproach: 'responsive',
      keepLogo: true,
      keepSourceImages: true,
    } as StylePreferences);
    expect(selected).toContain(heroAsset);
  });

  it('keepSourceImages: false — source photos excluded from asset list', () => {
    const selected = selectPromptAssets([logoAsset, heroAsset], {
      designDirection: 'modernize',
      colorPreference: 'suggest-new',
      typographyStyle: 'modern',
      layoutApproach: 'responsive',
      keepLogo: true,
      keepSourceImages: false,
    } as StylePreferences);
    expect(selected).not.toContain(heroAsset);
  });

  it('keepSourceImages: true prompt — USE IMPORTED ASSETS directive', () => {
    const prompt = buildPromptWith({ keepLogo: true, keepSourceImages: true });
    expect(prompt).toContain('USE IMPORTED ASSETS');
    expect(prompt).toContain('DO NOT GENERATE NEW IMAGES');
    expect(prompt).toContain('Do NOT use the media tool');
  });

  it('keepSourceImages: false + keepLogo: true prompt — REIMAGINE WITH FRESH IMAGERY directive', () => {
    const prompt = buildPromptWith({ keepLogo: true, keepSourceImages: false });
    expect(prompt).toContain('REIMAGINE WITH FRESH IMAGERY');
    expect(prompt).toContain('media tool');
    expect(prompt).not.toContain('DO NOT GENERATE NEW IMAGES');
  });

  it('keepSourceImages: false + keepLogo: false prompt — FRESH IMAGERY, NO SOURCE BRAND ASSETS directive', () => {
    const prompt = buildPromptWith({ keepLogo: false, keepSourceImages: false });
    expect(prompt).toContain('FRESH IMAGERY, NO SOURCE BRAND ASSETS');
    expect(prompt).not.toContain('USE IMPORTED ASSETS');
  });
});
