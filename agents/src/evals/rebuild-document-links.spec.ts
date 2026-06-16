/**
 * Static eval (AIROBUILD-2246): rebuild page prompts must surface in-content
 * document links with exact absolute URLs so the develop agent preserves PDF
 * targets instead of inventing #-anchors or wrong internal routes.
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
  sourceUrl: 'https://urbancookies.com',
  sitePurpose: 'Bakery',
  targetAudience: 'Local customers',
  brandVoice: 'Warm',
  designStyle: 'Cozy',
  colorPalette: { primary: ['#000'], secondary: [], accent: [] },
  typography: { headingFonts: ['Inter'], bodyFonts: ['Inter'], scale: [] },
  scrapedAt: '2024-01-01T00:00:00Z',
  version: '1',
};

const stylePreferences: StylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
};

const assetManifest: AssetManifest = {
  assets: [],
  totalAssets: 0,
  byType: { image: 0, font: 0, icon: 0, other: 0 },
  generatedAt: '2024-01-01T00:00:00Z',
};

describe('rebuild page prompt — document link preservation', function documentLinkPromptTests() {
  const pageContent: PageContent = {
    url: 'https://urbancookies.com/cakes',
    slug: 'cakes',
    title: 'Cakes',
    content: 'Cakes page',
    sanitizedContent: 'Cakes page body',
    structure: {
      hasHeader: true,
      hasFooter: true,
      hasSidebar: false,
      sections: [],
      navigation: [],
      contentLinks: [
        {
          label: 'printer-friendly cake cutting guide',
          url: 'https://urbancookies.com/files/cake-cutting-guide.pdf',
          isExternal: false,
        },
        {
          label: 'printer-friendly menu',
          url: 'https://urbancookies.com/files/menu.pdf',
          isExternal: false,
        },
      ],
    },
    metadata: { title: 'Cakes' },
    scrapedAt: '2024-01-01T00:00:00Z',
  };

  const prompt = buildUserPrompt({
    siteMetadata,
    pageContent,
    stylePreferences,
    assetManifest,
    isFirstPage: false,
    hasScreenshot: false,
  });

  it('surfaces document links with exact absolute URLs', function absoluteUrls() {
    expect(prompt).toContain('IN-CONTENT DOCUMENT LINKS');
    expect(prompt).toContain('https://urbancookies.com/files/cake-cutting-guide.pdf');
    expect(prompt).toContain('https://urbancookies.com/files/menu.pdf');
    expect(prompt).toContain('printer-friendly cake cutting guide');
    expect(prompt).toContain('printer-friendly menu');
  });

  it('instructs the agent to preserve hrefs verbatim and open in a new tab', function preserveInstructions() {
    expect(prompt).toContain('Do NOT rewrite them to internal routes');
    expect(prompt).toContain('target="_blank" rel="noopener noreferrer"');
  });
});
