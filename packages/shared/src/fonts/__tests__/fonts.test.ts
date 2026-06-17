import { describe, it, expect } from 'vitest';
import {
  FONT_THEMES,
  clampWeightsToAvailable,
  loadGoogleFontsCatalog,
  TAG_EXAMPLE_FONTS,
  TAG_EXAMPLE_FONT_FAMILIES,
  type FontPairing,
  type GoogleFontEntry,
} from '../index.js';

const ALLOWED_CATEGORIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];
const TAG_SHAPE = /^(Feeling|Appearance|Calligraphy|Serif|Sans Serif)\/.+/;

describe('@airo/shared/fonts FONT_THEMES', () => {
  it('exposes the four curated pairings with header+body fonts', () => {
    const ids = Object.keys(FONT_THEMES);
    expect(ids).toEqual(
      expect.arrayContaining([
        'modern-professional',
        'elegant-serif',
        'bold-modern',
        'classic-formal',
      ]),
    );
    for (const id of ids) {
      const theme: FontPairing = FONT_THEMES[id]!;
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.headerFont.name).toBeTruthy();
      expect(Array.isArray(theme.headerFont.weights)).toBe(true);
      expect(theme.headerFont.weights.length).toBeGreaterThan(0);
      expect(theme.bodyFont.name).toBeTruthy();
      expect(Array.isArray(theme.bodyFont.weights)).toBe(true);
      expect(theme.bodyFont.weights.length).toBeGreaterThan(0);
    }
  });

  it('preserves the modern-professional pairing values', () => {
    expect(FONT_THEMES['modern-professional']!.headerFont.name).toBe('Montserrat');
    expect(FONT_THEMES['modern-professional']!.bodyFont.name).toBe('Inter');
  });
});

describe('loadGoogleFontsCatalog', () => {
  it('lazily resolves a non-empty, well-shaped catalog', async () => {
    const catalog = await loadGoogleFontsCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(100);
    for (const entry of catalog) {
      expect(typeof entry.family).toBe('string');
      expect(entry.family.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.weights)).toBe(true);
      for (const w of entry.weights) {
        expect(typeof w).toBe('string');
      }
      expect(ALLOWED_CATEGORIES).toContain(entry.category);
      expect(Array.isArray(entry.tags)).toBe(true);
      for (const t of entry.tags) {
        expect(typeof t).toBe('string');
      }
    }
  });

  it('returns the same array instance on repeat calls (memoized)', async () => {
    const a = await loadGoogleFontsCatalog();
    const b = await loadGoogleFontsCatalog();
    expect(a).toBe(b);
  });
});

describe('Google Fonts catalog tags', () => {
  it('has at least some entries with non-empty tags', async () => {
    const catalog: GoogleFontEntry[] = await loadGoogleFontsCatalog();
    const tagged = catalog.filter((e) => e.tags.length > 0);
    expect(tagged.length).toBeGreaterThan(0);
  });

  it('every tag matches the canonical "<Label>/<Tag>" shape', async () => {
    const catalog: GoogleFontEntry[] = await loadGoogleFontsCatalog();
    for (const entry of catalog) {
      for (const tag of entry.tags) {
        expect(tag).toMatch(TAG_SHAPE);
      }
    }
  });
});

describe('TAG_EXAMPLE_FONTS', () => {
  it('maps canonical tags to example font families', () => {
    const entries = Object.entries(TAG_EXAMPLE_FONTS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [tag, family] of entries) {
      expect(tag).toMatch(TAG_SHAPE);
      expect(typeof family).toBe('string');
      expect(family.length).toBeGreaterThan(0);
    }
  });

  it('TAG_EXAMPLE_FONT_FAMILIES is the deduped set of mapped families', () => {
    expect(Array.isArray(TAG_EXAMPLE_FONT_FAMILIES)).toBe(true);
    expect(TAG_EXAMPLE_FONT_FAMILIES.length).toBeGreaterThan(0);
    expect(new Set(TAG_EXAMPLE_FONT_FAMILIES).size).toBe(TAG_EXAMPLE_FONT_FAMILIES.length);
    const families = new Set(TAG_EXAMPLE_FONT_FAMILIES);
    for (const family of Object.values(TAG_EXAMPLE_FONTS)) {
      expect(families.has(family)).toBe(true);
    }
  });

  it('excludes Google brand fonts that the public API does not serve', () => {
    for (const family of TAG_EXAMPLE_FONT_FAMILIES) {
      expect(family).not.toMatch(/google sans|product sans|material (symbols|icons)/i);
    }
  });
});

describe('@airo/shared/fonts clampWeightsToAvailable', () => {
  it('drops a weight a 400-only family does not ship (Bebas Neue)', async () => {
    expect(await clampWeightsToAvailable('Bebas Neue', ['400', '700'])).toEqual(['400']);
  });

  it('keeps weights a multi-weight family does ship (Oswald)', async () => {
    expect(await clampWeightsToAvailable('Oswald', ['400', '700'])).toEqual(['400', '700']);
  });

  it('is case-insensitive on the family name', async () => {
    expect(await clampWeightsToAvailable('bebas neue', ['700'])).toEqual(['400']);
  });

  it('returns requested weights unchanged for an uncatalogued family', async () => {
    expect(await clampWeightsToAvailable('Totally Made Up Font', ['400', '700'])).toEqual(['400', '700']);
  });

  it('falls back to 400 when none of the requested weights exist', async () => {
    // Bebas Neue ships only 400; requesting only 900 yields 400 rather than nothing.
    expect(await clampWeightsToAvailable('Bebas Neue', ['900'])).toEqual(['400']);
  });
});
