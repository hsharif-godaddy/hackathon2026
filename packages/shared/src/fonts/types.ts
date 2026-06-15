export type FontCategory = 'serif' | 'sans-serif' | 'monospace' | 'cursive' | 'fantasy';

export interface FontInfo {
  name: string;
  weights: string[];
  category: FontCategory;
}

/** A curated heading+body pairing. */
export interface FontPairing {
  name: string;
  description: string;
  headerFont: FontInfo;
  bodyFont: FontInfo;
  /** Legacy single-font field kept for backwards compatibility; unused by current themes. */
  font?: {
    name: string;
    weights: string[];
    category: FontCategory;
    fallback: string;
    googleFontsUrl: string;
  };
}

/** One entry in the bundled Google Fonts catalog (for the searchable picker). */
export interface GoogleFontEntry {
  family: string;
  category: FontCategory;
  weights: string[];
  /** Google Fonts discovery tags as canonical "UILabel/Tag" strings, e.g. "Feeling/Calm". */
  tags: string[];
}
