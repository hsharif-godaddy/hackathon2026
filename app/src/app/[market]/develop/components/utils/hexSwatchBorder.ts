import { getLuminance } from '@/utils/color'

export const HISTORY_SWATCH_PANEL_HEX = '#ffffff'
export const HISTORY_SWATCH_BORDER = '#D4DBE0'

/** Minimum contrast vs history card background before the swatch needs a visible border. */
const MIN_SWATCH_PANEL_CONTRAST = 1.5

function contrastRatio(luminanceA: number, luminanceB: number): number {
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)
  return (lighter + 0.05) / (darker + 0.05)
}

export function hexSwatchBorderColor(
  normalizedHex: string,
  panelHex: string = HISTORY_SWATCH_PANEL_HEX
): string {
  const swatchLuminance = getLuminance(normalizedHex)
  const panelLuminance = getLuminance(panelHex)
  if (contrastRatio(swatchLuminance, panelLuminance) < MIN_SWATCH_PANEL_CONTRAST) {
    return HISTORY_SWATCH_BORDER
  }
  return 'transparent'
}
