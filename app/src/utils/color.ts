/**
 * Color Utilities
 * 
 * Shared utilities for color manipulation and accessibility calculations.
 */

/**
 * Calculate relative luminance of a color using WCAG formula
 * 
 * Uses the WCAG 2.0 relative luminance formula to determine the perceived
 * brightness of a color. This is used for calculating contrast ratios.
 * 
 * @param hex - Hex color code (e.g., '#FF5733')
 * @returns Luminance value between 0 (darkest) and 1 (lightest)
 * 
 * @see https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
export function getLuminance(hex: string): number {
  const rgb = parseInt(hex.slice(1), 16)
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = (rgb >> 0) & 0xff

  const [rs, gs, bs] = [r, g, b].map(function normalize(c) {
    const val = c / 255
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Determine optimal text color (black or white) for a background color
 * 
 * Uses WCAG luminance calculation to determine whether white or black text
 * provides better contrast on the given background color. This ensures
 * readable text that meets accessibility standards.
 * 
 * @param hex - Background hex color (e.g., '#FF5733')
 * @returns '#FFFFFF' for white text or '#000000' for black text
 * 
 * @example
 * ```typescript
 * getContrastColor('#FF5733') // Returns '#FFFFFF' (white text on orange)
 * getContrastColor('#F0F0F0') // Returns '#000000' (black text on light gray)
 * ```
 */
export function getContrastColor(hex: string): string {
  const luminance = getLuminance(hex)
  return luminance > 0.5 ? '#000000' : '#FFFFFF'
}

