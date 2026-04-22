import type { BrandDataPalette } from '@/hooks/useBrandData';

export interface BrandStyle {
  headingFont: string | undefined;
  bodyFont: string | undefined;
  primary: string | undefined;
  primaryFg: string | undefined;
}

export type SuggestPromptFn = (prompt: string) => void;

export interface SectionThemeProps {
  palette?: BrandDataPalette;
  inverted?: boolean;
}

export interface BrandBookViewProps {
  appId: string;
}
