import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme'

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
export function getDisplayColors(palette: CompletePalette, t: (key: string) => string): DisplayColor[] {
  return [
    { name: t('builder_colors_base_name'), background: palette.background, foreground: palette.foreground, role: t('builder_colors_base_role') },
    { name: t('builder_colors_primary_name'), background: palette.primary, foreground: palette.primaryForeground, role: t('builder_colors_primary_role') },
    { name: t('builder_colors_secondary_name'), background: palette.secondary, foreground: palette.secondaryForeground, role: t('builder_colors_secondary_role') },
    { name: t('builder_colors_accent_name'), background: palette.accent, foreground: palette.accentForeground, role: t('builder_colors_accent_role') },
    { name: t('builder_colors_muted_name'), background: palette.muted, foreground: palette.mutedForeground, role: t('builder_colors_muted_role') },
  ]
}
