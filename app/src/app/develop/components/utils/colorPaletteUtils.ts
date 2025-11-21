import type { CompletePalette } from '../widgets/ColorPaletteGridWidget'

/**
 * Display color information for rendering color details
 */
export interface DisplayColor {
  name: string
  background: string
  foreground: string
  role: string
}

/**
 * Get display colors from palette for modal rendering
 *
 * Extracts the 5 main colors (Base, Primary, Secondary, Accent, Muted) from a complete palette
 * for display purposes in modals and color pickers.
 *
 * @param palette - Complete palette with all color definitions
 * @returns Array of 5 display colors with name, background, foreground, and role
 */
export function getDisplayColors(palette: CompletePalette): DisplayColor[] {
  return [
    { name: 'Base', background: palette.background, foreground: palette.foreground, role: 'Base text and background color' },
    { name: 'Primary', background: palette.primary, foreground: palette.primaryForeground, role: 'Main brand color' },
    { name: 'Secondary', background: palette.secondary, foreground: palette.secondaryForeground, role: 'Secondary brand color' },
    { name: 'Accent', background: palette.accent, foreground: palette.accentForeground, role: 'Accent and highlights' },
    { name: 'Muted', background: palette.muted, foreground: palette.mutedForeground, role: 'Subtle backgrounds' },
  ]
}
