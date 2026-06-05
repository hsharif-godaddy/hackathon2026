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

import { buildUserPrompt } from '../agents/page-prompt/user-prompt-builder.js';
import type {
  AssetManifest,
  PageContent,
  SiteMetadata,
  StylePreferences,
} from '../types/rebuild.js';

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

describe('rebuild page prompt — imported-asset directive', () => {
  const prompt = buildUserPrompt({ siteMetadata, pageContent, stylePreferences: {
    designDirection: 'keep-similar',
    colorPreference: 'keep-original',
    typographyStyle: 'keep-original',
    layoutApproach: 'responsive',
  } as StylePreferences, assetManifest, isFirstPage: false });

  it('instructs the agent to use imported assets and not generate images', () => {
    expect(prompt).toContain('USE IMPORTED ASSETS');
    expect(prompt).toContain('DO NOT GENERATE NEW IMAGES');
    expect(prompt).toContain('Do NOT use the media tool');
  });

  it('surfaces imported asset paths as servable /assets/ URLs', () => {
    expect(prompt).toContain('/assets/images/hero.jpg');
    // The source-site on-disk prefix must never leak into the prompt.
    expect(prompt).not.toContain('.source-site/assets/');
  });
});
