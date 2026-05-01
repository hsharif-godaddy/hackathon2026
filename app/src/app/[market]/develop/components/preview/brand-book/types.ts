import type { BrandDataPalette } from '@/hooks/useBrandData';

export interface BrandStyle {
  headingFont: string | undefined;
  bodyFont: string | undefined;
  primary: string | undefined;
  primaryFg: string | undefined;
}

export interface SectionThemeProps {
  palette?: BrandDataPalette;
}

export interface BrandBookViewProps {
  appId: string;
}
