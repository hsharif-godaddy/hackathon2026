/**
 * Static eval (AIROBUILD-2104 / AIROBUILD-2715 / AIROBUILD-2717): the rebuild
 * page prompt MUST instruct the agent correctly based on the bring-over toggle.
 *
 * Three regression classes guarded here:
 * 1. (2104/2717) When the agent fabricates images instead of reusing scraped
 *    source — guarded by the USE THE MEDIA TOOL directive. The agent routes all
 *    images through the media tool; fillSlotFromRebuildSource intercepts and
 *    fills slots with matching scraped photos when keepSourceImages is true.
 * 2. (2715) When a bring-over toggle is flipped, the prompt must shift the
 *    directive AND the visible asset list to match — guarded by the four
 *    toggle-dimension assertions at the bottom of this file.
 * 3. (2717) Keep-similar rebuilds must create media slots (airo-media.json
 *    populated) — guarded by asserting media-tool routing, not hardcoded paths.
 *
 * All assertions are deterministic over the built prompt string (no LLM, no
 * provider keys). The behavioral counterpart (slots actually populate) is
 * verified manually via E2E — see PR #5631 test confirmation.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { buildUserPrompt, isLikelyLogo, selectPromptAssets } from '../agents/page-prompt/user-prompt-builder.js';
import { selectSystemPromptFiles } from '../agents/page-prompt-agent.js';
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
  // AIROBUILD-2717: keep-similar now routes through the media tool so slots are created,
  // but fillSlotFromRebuildSource intercepts to serve the scraped photos.
  describe('keep-similar (clone)', () => {
    const prompt = buildPromptForDirection('keep-similar');

    it('instructs the agent to use the media tool for all images (slots created, source photos served)', () => {
      expect(prompt).toContain('USE THE MEDIA TOOL FOR ALL IMAGES');
      expect(prompt).toContain('swappable slots');
      expect(prompt).not.toContain('Do NOT use the media tool');
    });

    it('instructs the agent to use a slot path containing "logo" for the logo', () => {
      // The concrete instruction: slot path naming, not query-based routing
      expect(prompt).toContain('slot path containing "logo"');
      expect(prompt).toMatch(/components\/logo|header\/logo/); // example paths in the instruction
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

  // System prompt (asset-integration.md) content assertions — guards against
  // regressions in the prompt fragments themselves, not just user-prompt assembly.
  describe('system prompt fragment content (asset-integration.md)', () => {
    const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../prompts/page-prompt');
    const assetIntegrationContent = readFileSync(join(promptsDir, 'asset-integration.md'), 'utf-8');

    it('selects asset-integration.md for keep-similar (preserveDesign: true)', () => {
      const files = selectSystemPromptFiles({ isFirstPage: true, useAtlasCrawler: true, preserveDesign: true });
      expect(files).toContain('asset-integration.md');
      expect(files).not.toContain('asset-integration-redesign.md');
    });

    it('selects asset-integration-redesign.md for modernize (preserveDesign: false)', () => {
      const files = selectSystemPromptFiles({ isFirstPage: true, useAtlasCrawler: true, preserveDesign: false });
      expect(files).toContain('asset-integration-redesign.md');
      expect(files).not.toContain('asset-integration.md');
    });

    it('asset-integration.md instructs media tool usage for all images', () => {
      expect(assetIntegrationContent).toContain('ALWAYS use the media tool');
      expect(assetIntegrationContent).toContain('swappable media slots');
      expect(assetIntegrationContent).not.toContain('Reference real assets by their public path');
    });

    it('asset-integration.md instructs logo slot path naming (not query-based)', () => {
      expect(assetIntegrationContent).toContain('slot path containing "logo"');
      expect(assetIntegrationContent).toMatch(/components\/logo|header\/logo/);
    });

    it('asset-integration.md does not make unconditional source-fill promise', () => {
      // Softened wording for keep-similar + keepSourceImages:false edge case
      expect(assetIntegrationContent).toContain('When source images are enabled');
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

  it('keepSourceImages: true prompt — USE THE MEDIA TOOL FOR ALL IMAGES directive', () => {
    const prompt = buildPromptWith({ keepLogo: true, keepSourceImages: true });
    expect(prompt).toContain('USE THE MEDIA TOOL FOR ALL IMAGES');
    expect(prompt).toContain('swappable slots');
    expect(prompt).not.toContain('Do NOT use the media tool');
    // Logo instruction guard - slot path naming, not query-based routing
    expect(prompt).toContain('slot path containing "logo"');
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
