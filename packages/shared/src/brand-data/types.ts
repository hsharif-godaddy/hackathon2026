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
  heading?: { family: string; weights: string[] };
  body?: { family: string; weights: string[] };
}

export interface BrandDataLogoVariant {
  transparent?: string;
  solid?: string;
}

export interface BrandDataLogo {
  square?: BrandDataLogoVariant;
  horizontal?: BrandDataLogoVariant;
  vertical?: BrandDataLogoVariant;
  guidelines?: string;
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

export interface BrandData {
  version: number;
  brandName?: string;
  tagline?: string;
  logo?: BrandDataLogo;
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
}
