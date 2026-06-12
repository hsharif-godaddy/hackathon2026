/**
 * Guards the load-bearing line of AIROBUILD-2430: generate() must append the
 * embedded-text constraint to the LLM's output. The rebuild-prompts eval covers
 * this end-to-end but makes real LLM calls and runs locally — so without this
 * test, deleting the `+ buildEmbeddedTextConstraint(...)` append would pass CI.
 *
 * The LLM call is stubbed (getAgent returns a fixed string); everything else in
 * generate() is pure, so this exercises the real append wiring deterministically.
 */
import { describe, expect, it } from 'vitest';

import { PagePromptAgent } from '../page-prompt-agent.js';
import type {
  AssetInfo,
  AssetManifest,
  PageContent,
  SiteMetadata,
  StylePreferences,
} from '../../types/rebuild.js';

const GENERATED = '## Generated build prompt\nBuild the homepage.';

const siteMetadata: SiteMetadata = {
  sourceUrl: 'https://example.com',
  sitePurpose: 'Restaurant',
  targetAudience: 'Diners',
  brandVoice: 'Warm',
  designStyle: 'Rustic',
  colorPalette: { primary: ['#1b4d2e'], secondary: [], accent: [] },
  typography: { headingFonts: ['Playfair Display'], bodyFonts: ['Source Sans Pro'], scale: [] },
  scrapedAt: '2026-06-11T00:00:00Z',
  version: '1',
};

const pageContent: PageContent = {
  url: 'https://example.com/',
  slug: 'homepage',
  title: 'Home',
  content: '<h1>Welcome</h1>',
  sanitizedContent: '<h1>Welcome</h1><p>Honest food.</p>',
  structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
  metadata: { title: 'Home' },
  scrapedAt: '2026-06-11T00:00:00Z',
};

const stylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
} as StylePreferences;

function manifest(assets: AssetInfo[]): AssetManifest {
  return {
    assets,
    totalAssets: assets.length,
    byType: { image: assets.length, font: 0, icon: 0, other: 0 },
    generatedAt: '2026-06-11T00:00:00Z',
  };
}

/** PagePromptAgent with the LLM stubbed to return a fixed string. */
function stubbedAgent(): PagePromptAgent {
  const agent = new PagePromptAgent({ isFirstPage: true, preserveDesign: true });
  // Bypass initialize()/the real model — only the append wiring is under test.
  (agent as unknown as { getAgent: () => unknown }).getAgent = () => ({
    generate: async () => ({ content: GENERATED }),
  });
  return agent;
}

const heroWithText: AssetInfo = {
  url: 'https://example.com/marquee.jpg',
  localPath: '.source-site/assets/images/marquee.jpg',
  type: 'image',
  usageContext: 'hero',
  hasEmbeddedText: true,
  embeddedText: 'Bon Appetito',
  dimensions: { width: 1440, height: 600 },
  sourcePages: ['https://example.com/'],
};

describe('PagePromptAgent.generate — embedded-text constraint append', () => {
  it('appends the no-overlay constraint after the generated prompt', async () => {
    const out = await stubbedAgent().generate(
      siteMetadata, pageContent, stylePreferences, manifest([heroWithText]), true
    );
    expect(out).toContain(GENERATED);
    expect(out).toContain('do NOT overlay');
    expect(out).toContain('Bon Appetito');
    // The constraint lands after the generated prompt, not before it.
    expect(out.indexOf('do NOT overlay')).toBeGreaterThan(out.indexOf(GENERATED));
  });

  it('appends nothing when no asset has embedded text', async () => {
    const plain: AssetInfo = { ...heroWithText, hasEmbeddedText: false, embeddedText: null };
    const out = await stubbedAgent().generate(
      siteMetadata, pageContent, stylePreferences, manifest([plain]), true
    );
    expect(out).toBe(GENERATED);
  });
});
