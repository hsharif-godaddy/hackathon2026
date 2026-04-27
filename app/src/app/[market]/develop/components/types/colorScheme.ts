/**
 * Complete palette data structure (matches GeneratedPalette from backend)
 */
export interface CompletePalette {
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  accent: string
  accentForeground: string
  background: string
  foreground: string
  muted: string
  mutedForeground: string
  border: string
  destructive: string
  destructiveForeground: string
  success: string
  successForeground: string
  warning: string
  warningForeground: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
}

/**
 * Palette data for grid display
 */
export interface PaletteData {
  name: string
  theme?: 'light' | 'dark'
  palette: CompletePalette
}
