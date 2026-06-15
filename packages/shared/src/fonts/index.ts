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
