/**
 * Brand Data Types
 *
 * Shared type definitions for brand book data, used by both the agents service
 * (brand-data route, parsers) and the app (BrandBookView, useBrandData hook).
 */

export interface BrandDataColors {
  primary?: { name: string; value: string };
  accent?: { name: string; value: string };
  secondary?: Array<{ name: string; value: string }>;
}

export interface BrandDataPalette {
  name?: string;
  primary?: string;
  primaryForeground?: string;
  secondary?: string;
  secondaryForeground?: string;
  accent?: string;
  accentForeground?: string;
  background?: string;
  foreground?: string;
  muted?: string;
  mutedForeground?: string;
  border?: string;
  card?: string;
  cardForeground?: string;
  destructive?: string;
  destructiveForeground?: string;
  success?: string;
  successForeground?: string;
  warning?: string;
  warningForeground?: string;
  chart1?: string;
  chart2?: string;
  chart3?: string;
  chart4?: string;
  chart5?: string;
  theme?: 'light' | 'dark';
  displayColors?: Array<{ id: string; name: string; hex: string; role: string; foreground: string }>;
}

export interface BrandDataTypography {
  /** Friendly name of the chosen font pairing, e.g. "Modern Professional". */
  name?: string;
  heading?: { family: string; weights: string[] };
  body?: { family: string; weights: string[] };
}

export interface BrandDataPersonality {
  description?: string;
  traits?: Array<{ name: string; description: string }>;
}

export interface BrandDataVoice {
  weAre?: string[];
  weAreNot?: string[];
  sampleCopy?: { headline: string; body: string };
}

export interface BrandDataIconography {
  style?: string;
  tags?: string[];
}

export interface BrandDataLayout {
  grid?: string;
  spacing?: string;
  components?: string;
}

export interface BrandDataAudience {
  description?: string;
  segments?: string[];
}

export interface BrandDataPhotography {
  style?: string;
  subjects?: string[];
  avoid?: string[];
  treatments?: string[];
}

export interface BrandDataMission {
  statement?: string;
  story?: string;
  values?: string[];
}

export interface BrandDataToneMatrix {
  contexts: Array<{
    context: string;
    description?: string;
    tone: string;
    language?: string;
    purpose?: string;
    examples?: string[];
  }>;
}

export interface BrandDataSummary {
  text?: string;
}

export interface BrandDataMoodImage {
  /** Media-manifest slot path, e.g. "brand/mood-1". */
  slot: string;
  /** Current resolved image URL for the slot (manifest `currentUrl`). */
  url: string;
}

export interface BrandDataImagery {
  /** A single descriptor phrase used as the stock-search key, e.g.
   * "Minimal neutral fashion lifestyle, airy whites, soft textures, quiet luxury". */
  keyword?: string;
  /** Cohesive brand-mood image set — the visual identity that conveys the
   * brand's look & feel. Resolved from the media-manifest `brand/mood-*` slots
   * (deterministic; not agent-written). */
  moodImages?: BrandDataMoodImage[];
}

export interface BrandDataWizard {
  /** Active wizard step, 1–5. */
  step?: 1 | 2 | 3 | 4 | 5;
}

/**
 * Compact element "shape language" parsed from the installed kit's `anchor.json`
 * (radius / shadow / button casing). Lets the wizard's Elements preview render
 * the kit's actual shapes — driven by the user's live palette + fonts. Absent
 * for kits that ship no anchor.json or whose tokens couldn't be parsed.
 */
export interface BrandKitTokens {
  /** Corner radius (px) for general surfaces — cards, inputs, tags. */
  radiusBase?: number;
  /** Corner radius (px) for buttons (the kit's "subtle" radius). */
  radiusButton?: number;
  /** True when the kit's resting shadow is "none" (flat by default). */
  flat?: boolean;
  /** Whether buttons / labels are set UPPERCASE. */
  uppercase?: boolean;
  /** Letter-spacing for buttons / labels, e.g. "0.12em". */
  tracking?: string;
}

export interface BrandDataKit {
  /** Friendly name of the chosen design system / kit, e.g. "Volt". */
  name?: string;
}

export interface BrandData {
  version: number;
  brandName?: string;
  tagline?: string;
  palette?: BrandDataPalette;
  typography?: BrandDataTypography;
  personality?: BrandDataPersonality;
  voice?: BrandDataVoice;
  iconography?: BrandDataIconography;
  layout?: BrandDataLayout;
  audience?: BrandDataAudience;
  photography?: BrandDataPhotography;
  mission?: BrandDataMission;
  toneMatrix?: BrandDataToneMatrix;
  summary?: BrandDataSummary;
  imagery?: BrandDataImagery;
  wizard?: BrandDataWizard;
  kit?: BrandDataKit;
}
