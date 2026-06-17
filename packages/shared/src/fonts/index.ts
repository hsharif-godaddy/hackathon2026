export type { FontCategory, FontInfo, FontPairing, GoogleFontEntry } from './types.js';
export { FONT_THEMES } from './font-themes.js';
// Small static module (NOT the big catalog): per-tag example fonts for the filter
// chips, eagerly importable so chips render in their example typeface immediately.
export { TAG_EXAMPLE_FONTS, TAG_EXAMPLE_FONT_FAMILIES } from './tag-example-fonts.js';

import type { GoogleFontEntry } from './types.js';

let catalogPromise: Promise<GoogleFontEntry[]> | null = null;

/**
 * Lazily load the full Google Fonts catalog via dynamic import so the ~200 KB
 * module is only pulled into the bundle when a caller actually needs it (e.g.
 * when the user opens the font search). Memoized for the process/page lifetime.
 */
export function loadGoogleFontsCatalog(): Promise<GoogleFontEntry[]> {
  if (!catalogPromise) {
    catalogPromise = import('./google-fonts-catalog.js').then((m) => m.GOOGLE_FONTS_CATALOG);
  }
  return catalogPromise;
}

let weightIndex: Map<string, string[]> | null = null;

async function getWeightIndex(): Promise<Map<string, string[]>> {
  if (!weightIndex) {
    const catalog = await loadGoogleFontsCatalog();
    weightIndex = new Map(catalog.map((e) => [e.family.toLowerCase(), e.weights]));
  }
  return weightIndex;
}

/**
 * Clamp a set of desired font weights to those the family actually ships on
 * Google Fonts. Requesting an unavailable weight (e.g. `wght@700` for the
 * 400-only Bebas Neue) makes the css2 stylesheet return HTTP 400, so the whole
 * font fails to load and the page falls back to its CSS generic (AIROBUILD-2481).
 *
 * - Families absent from the catalog are returned unchanged (we can't verify
 *   them; the caller's URL validation remains the backstop).
 * - Always returns at least one weight: the requested ones that exist, else
 *   `400` if the family has it, else the family's lightest available weight.
 */
export async function clampWeightsToAvailable(family: string, desired: string[]): Promise<string[]> {
  const available = (await getWeightIndex()).get(family.toLowerCase());
  if (!available) return desired;

  const availableSet = new Set(available);
  const kept = desired.filter((w) => availableSet.has(w));
  if (kept.length > 0) return kept;

  if (availableSet.has('400')) return ['400'];
  const lightest = [...available].sort((a, b) => Number(a) - Number(b))[0];
  return lightest ? [lightest] : desired;
}
