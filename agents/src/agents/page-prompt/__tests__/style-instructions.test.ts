import { describe, expect, it } from 'vitest';

import type { SiteMetadata, StylePreferences } from '../../../types/rebuild.js';
import { buildDesignInstructions, buildTypographyInstructions } from '../style-instructions.js';

const baseMetadata: SiteMetadata = {
  sourceUrl: 'https://example.com',
  sitePurpose: 'Design studio',
  targetAudience: 'Creative professionals',
  brandVoice: 'Elegant',
  designStyle: 'Minimal',
  colorPalette: { primary: ['#000'], secondary: [], accent: [] },
  typography: {
    headingFonts: ['Playfair Display'],
    bodyFonts: ['Open Sans'],
    scale: [
      { fontFamily: 'Playfair Display', fontSize: '48px', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.02em', role: 'heading' },
      { fontFamily: 'Playfair Display', fontSize: '36px', fontWeight: '700', lineHeight: '1.2', letterSpacing: '-0.01em', role: 'heading' },
      { fontFamily: 'Open Sans', fontSize: '16px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '0', role: 'body' },
    ],
  },
  scrapedAt: '2024-01-01T00:00:00Z',
  version: '1',
};

const keepOriginalPrefs: StylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
};

const modernPrefs: StylePreferences = {
  ...keepOriginalPrefs,
  typographyStyle: 'modern',
};

describe('buildTypographyInstructions', () => {
  it('emits a preservation directive with font names when typographyStyle is keep-original', () => {
    const result = buildTypographyInstructions(keepOriginalPrefs, baseMetadata);
    expect(result).toContain('Playfair Display');
    expect(result).toContain('Open Sans');
    expect(result).toMatch(/preserve|keep|use.*source|match/i);
  });

  it('includes scale data (font sizes) when typographyStyle is keep-original and scale exists', () => {
    const result = buildTypographyInstructions(keepOriginalPrefs, baseMetadata);
    expect(result).toContain('48px');
    expect(result).toContain('16px');
  });

  it('does NOT include the AVOID system fonts directive when keep-original', () => {
    const result = buildTypographyInstructions(keepOriginalPrefs, baseMetadata);
    expect(result).not.toMatch(/AVOID.*Inter|AVOID.*Arial|AVOID.*system fonts/i);
  });

  it('emits a non-preservation directive for modern/classic/playful styles', () => {
    const result = buildTypographyInstructions(modernPrefs, baseMetadata);
    expect(result).not.toMatch(/preserve|must use/i);
    expect(result).toContain('Playfair Display');
  });

  it('handles missing scale gracefully (font names only)', () => {
    const noScale: SiteMetadata = {
      ...baseMetadata,
      typography: { headingFonts: ['Georgia'], bodyFonts: ['Verdana'] },
    };
    const result = buildTypographyInstructions(keepOriginalPrefs, noScale);
    expect(result).toContain('Georgia');
    expect(result).toContain('Verdana');
    expect(result).not.toContain('undefined');
  });

  it('returns empty string when no fonts detected', () => {
    const noFonts: SiteMetadata = {
      ...baseMetadata,
      typography: { headingFonts: [], bodyFonts: [] },
    };
    const result = buildTypographyInstructions(keepOriginalPrefs, noFonts);
    expect(result).toBe('');
  });

  it('only emits detected font bullets when one side is missing (asymmetric)', () => {
    const headingOnly: SiteMetadata = {
      ...baseMetadata,
      typography: { headingFonts: ['Playfair Display'], bodyFonts: [] },
    };
    const result = buildTypographyInstructions(keepOriginalPrefs, headingOnly);
    expect(result).toContain('Heading font: Playfair Display');
    expect(result).not.toContain('Body font');
    expect(result).not.toContain('not detected');
  });
});

describe('buildDesignInstructions', () => {
  it('does NOT instruct avoiding specific font families in keep-similar mode', () => {
    const result = buildDesignInstructions(keepOriginalPrefs, baseMetadata);
    expect(result).not.toMatch(/AVOID:.*Inter|AVOID:.*Roboto|AVOID:.*Arial/i);
  });

  it('includes TYPOGRAPHY DIRECTION cross-reference when fonts are detected', () => {
    const result = buildDesignInstructions(keepOriginalPrefs, baseMetadata);
    expect(result).toContain('See TYPOGRAPHY DIRECTION section');
  });

  it('omits TYPOGRAPHY DIRECTION cross-reference when no fonts detected', () => {
    const noFonts: SiteMetadata = {
      ...baseMetadata,
      typography: { headingFonts: [], bodyFonts: [] },
    };
    const result = buildDesignInstructions(keepOriginalPrefs, noFonts);
    expect(result).not.toContain('See TYPOGRAPHY DIRECTION section');
  });
});

describe('buildTypographyInstructions — additional coverage', () => {
  it('emits correct style label for classic', () => {
    const classicPrefs: StylePreferences = { ...keepOriginalPrefs, typographyStyle: 'classic' };
    const result = buildTypographyInstructions(classicPrefs, baseMetadata);
    expect(result).toContain('classic, refined');
  });

  it('emits correct style label for playful', () => {
    const playfulPrefs: StylePreferences = { ...keepOriginalPrefs, typographyStyle: 'playful' };
    const result = buildTypographyInstructions(playfulPrefs, baseMetadata);
    expect(result).toContain('playful, expressive');
  });
});
