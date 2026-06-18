import { describe, expect, it } from 'vitest';

import type { SiteMetadata, StylePreferences } from '../../../types/rebuild.js';
import { buildColorInstructions, buildDesignInstructions, buildTypographyInstructions, shouldPreserveDesign } from '../style-instructions.js';

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

  it('tells PagePromptAgent not to instruct fontTheme on keep-original rebuilds', function preAppliedGuidance() {
    const result = buildTypographyInstructions(keepOriginalPrefs, baseMetadata);
    expect(result).toContain('already applied to globals.css');
    expect(result).toContain('do NOT call fontTheme');
    expect(result).not.toMatch(/import them/i);
  });

  it('uses pre-applied CSS var guidance for all keep-original pages', function allPagesPreApplied() {
    const result = buildTypographyInstructions(keepOriginalPrefs, baseMetadata);
    expect(result).toContain('var(--font-heading)');
    expect(result).not.toMatch(/If Google Fonts provides them/i);
  });
});

describe('shouldPreserveDesign', () => {
  // Guards the single predicate the whole fix hinges on (AIROBUILD-2241): an
  // inverted comparison here silently reintroduces the bug. The production
  // caller (RebuildPromptBuilder) and the eval both derive preserveDesign from
  // this function.
  it('is true only for keep-similar (a faithful clone)', () => {
    expect(shouldPreserveDesign(keepOriginalPrefs)).toBe(true);
  });

  it('is false for every redesign direction', () => {
    for (const designDirection of ['modernize', 'simplify', 'bold'] as const) {
      expect(shouldPreserveDesign({ ...keepOriginalPrefs, designDirection })).toBe(false);
    }
  });

  it('ignores colorPreference (structure and color are independent axes)', () => {
    // "bold layout, keep colors" must still be a redesign on the design axis.
    expect(shouldPreserveDesign({ ...keepOriginalPrefs, designDirection: 'bold', colorPreference: 'keep-original' })).toBe(false);
    expect(shouldPreserveDesign({ ...keepOriginalPrefs, colorPreference: 'suggest-new' })).toBe(true);
  });
});

describe('buildDesignInstructions', () => {
  it('does NOT instruct avoiding specific font families in keep-similar mode', () => {
    const result = buildDesignInstructions(keepOriginalPrefs, baseMetadata, true);
    expect(result).not.toMatch(/AVOID:.*Inter|AVOID:.*Roboto|AVOID:.*Arial/i);
  });

  it('includes TYPOGRAPHY DIRECTION cross-reference when fonts are detected', () => {
    const result = buildDesignInstructions(keepOriginalPrefs, baseMetadata, true);
    expect(result).toContain('See TYPOGRAPHY DIRECTION section');
  });

  it('omits TYPOGRAPHY DIRECTION cross-reference when no fonts detected', () => {
    const noFonts: SiteMetadata = {
      ...baseMetadata,
      typography: { headingFonts: [], bodyFonts: [] },
    };
    const result = buildDesignInstructions(keepOriginalPrefs, noFonts, true);
    expect(result).not.toContain('See TYPOGRAPHY DIRECTION section');
  });

  it('emits the PRESERVE heading for keep-similar, not a redesign brief', () => {
    const result = buildDesignInstructions(keepOriginalPrefs, baseMetadata, true);
    // Anchor on the literal heading so a reword can't pass on loose keywords.
    expect(result).toContain('DESIGN DIRECTION (Preserve Source Design)');
    expect(result).not.toMatch(/Full Redesign Guidance|Let Airo Decide/i);
  });

  it('forbids adding sections the source does not have (keep-similar)', () => {
    const result = buildDesignInstructions(keepOriginalPrefs, baseMetadata, true);
    expect(result).toMatch(/ONLY the sections that exist|do not add sections/i);
  });

  it('references the screenshot as primary reference when one is attached', () => {
    const result = buildDesignInstructions(keepOriginalPrefs, baseMetadata, true);
    expect(result).toMatch(/attached homepage screenshot as the PRIMARY reference/i);
  });

  it('does NOT reference a screenshot when none is attached (falls back to extracted content)', () => {
    const result = buildDesignInstructions(keepOriginalPrefs, baseMetadata, false);
    expect(result).not.toMatch(/screenshot/i);
    expect(result).toMatch(/extracted page content/i);
  });

  it('omits the "reads as" style fragment when designStyle is empty', () => {
    const noStyle: SiteMetadata = { ...baseMetadata, designStyle: '' };
    const result = buildDesignInstructions(keepOriginalPrefs, noStyle, false);
    expect(result).not.toContain('reads as');
    expect(result).not.toContain('()');
  });

  it('still emits a redesign directive for explicit non-keep choices (bold)', () => {
    const boldPrefs: StylePreferences = { ...keepOriginalPrefs, designDirection: 'bold' };
    const result = buildDesignInstructions(boldPrefs, baseMetadata, true);
    expect(result).toMatch(/DESIGN DIRECTION \(Bold\)/i);
    expect(result).not.toMatch(/Preserve Source Design/i);
  });
});

describe('buildColorInstructions', () => {
  it('preserves the detected source palette for keep-original (no "Airo must pick")', () => {
    const result = buildColorInstructions(keepOriginalPrefs, baseMetadata, true);
    expect(result).toMatch(/Preserve Source Colors|KEEP the source/i);
    expect(result).toContain('#000');
    expect(result).not.toMatch(/YOU must (select|pick)|Airo's Choice|Let Airo Decide/i);
  });

  it('renders "(none detected)" for roles missing from a partial palette', () => {
    // baseMetadata has primary #000 only — secondary/accent are empty.
    const result = buildColorInstructions(keepOriginalPrefs, baseMetadata, true);
    expect(result).toContain('Primary: #000');
    expect(result).toContain('Secondary: (none detected)');
    expect(result).toContain('Accent: (none detected)');
  });

  it('cross-references the screenshot only when one is attached', () => {
    expect(buildColorInstructions(keepOriginalPrefs, baseMetadata, true)).toMatch(/screenshot/i);
    expect(buildColorInstructions(keepOriginalPrefs, baseMetadata, false)).not.toMatch(/screenshot/i);
  });

  it('falls back to brand-derived colors when no palette detected', () => {
    const noColors: SiteMetadata = {
      ...baseMetadata,
      colorPalette: { primary: [], secondary: [], accent: [] },
    };
    const result = buildColorInstructions(keepOriginalPrefs, noColors, true);
    expect(result).toMatch(/no palette was reliably detected|Derive/i);
    expect(result).not.toContain('undefined');
  });

  it('emits a fresh-scheme directive for suggest-new', () => {
    const suggestPrefs: StylePreferences = { ...keepOriginalPrefs, colorPreference: 'suggest-new' };
    const result = buildColorInstructions(suggestPrefs, baseMetadata, true);
    expect(result).toMatch(/Fresh Color Scheme|new color scheme/i);
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
