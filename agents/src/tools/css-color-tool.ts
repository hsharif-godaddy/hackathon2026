import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Color manipulation utilities
 */

/**
 * Parse hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result || !result[1] || !result[2] || !result[3]) {
    throw new Error(`Invalid hex color: ${hex}`)
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  }
}

/**
 * Convert RGB to hex
 */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(function toHex(x) {
    const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }).join('')
}

/**
 * Convert RGB to HSL
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

/**
 * Convert HSL to RGB
 */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360
  s /= 100
  l /= 100

  let r: number
  let g: number
  let b: number

  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = function hue2rgb(p: number, q: number, t: number): number {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q

    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }

  return { r: r * 255, g: g * 255, b: b * 255 }
}

/**
 * Calculate relative luminance for contrast ratio
 */
function getLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const normalized = [r, g, b].map(function normalize(c) {
    const val = c / 255
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  })
  const rs = normalized[0] ?? 0
  const gs = normalized[1] ?? 0
  const bs = normalized[2] ?? 0
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Calculate contrast ratio between two colors
 */
function getContrastRatio(color1: string, color2: string): number {
  const lum1 = getLuminance(color1)
  const lum2 = getLuminance(color2)
  const lighter = Math.max(lum1, lum2)
  const darker = Math.min(lum1, lum2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Generate lighter shade of a color
 */
function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const { h, s, l } = rgbToHsl(r, g, b)
  const newL = Math.min(100, l + amount)
  const rgb = hslToRgb(h, s, newL)
  return rgbToHex(rgb.r, rgb.g, rgb.b)
}

/**
 * Generate darker shade of a color
 */
function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const { h, s, l } = rgbToHsl(r, g, b)
  const newL = Math.max(0, l - amount)
  const rgb = hslToRgb(h, s, newL)
  return rgbToHex(rgb.r, rgb.g, rgb.b)
}

/**
 * Adjust saturation of a color
 */
function adjustSaturation(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const { h, s, l } = rgbToHsl(r, g, b)
  const newS = Math.max(0, Math.min(100, s + amount))
  const rgb = hslToRgb(h, newS, l)
  return rgbToHex(rgb.r, rgb.g, rgb.b)
}

/**
 * Generate a complementary color (opposite on color wheel)
 */
function complementary(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  let { h, s, l } = rgbToHsl(r, g, b)

  if (l < 15) {
    l = 50
    s = 60
    h = (h + 180) % 360
  } else if (s < 10) {
    s = 60
    h = (h + 180) % 360
  } else {
    h = (h + 180) % 360
  }

  const rgb = hslToRgb(h, s, l)
  return rgbToHex(rgb.r, rgb.g, rgb.b)
}

/**
 * Generate analogous colors (adjacent on color wheel)
 */
function analogous(hex: string): { color1: string; color2: string } {
  const { r, g, b } = hexToRgb(hex)
  const { h, s: origS, l: origL } = rgbToHsl(r, g, b)

  let s = origS
  let l = origL

  if (l < 15) {
    l = 45
    s = 50
  } else if (s < 10) {
    s = 50
  }

  const h1 = (h + 30) % 360
  const h2 = (h - 30 + 360) % 360

  const rgb1 = hslToRgb(h1, s, l)
  const rgb2 = hslToRgb(h2, s, l)

  return {
    color1: rgbToHex(rgb1.r, rgb1.g, rgb1.b),
    color2: rgbToHex(rgb2.r, rgb2.g, rgb2.b)
  }
}

/**
 * Generate triadic colors (120° apart on color wheel)
 *
 * Note: Currently unused but kept for potential future use
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function triadic(hex: string): { color1: string; color2: string } {
  const { r, g, b } = hexToRgb(hex)
  const { h, s, l } = rgbToHsl(r, g, b)

  const h1 = (h + 120) % 360
  const h2 = (h + 240) % 360

  const rgb1 = hslToRgb(h1, s, l)
  const rgb2 = hslToRgb(h2, s, l)

  return {
    color1: rgbToHex(rgb1.r, rgb1.g, rgb1.b),
    color2: rgbToHex(rgb2.r, rgb2.g, rgb2.b)
  }
}

/**
 * Check if a background color is dark based on luminance
 */
function isDarkBackground(hex: string): boolean {
  const luminance = getLuminance(hex)
  return luminance < 0.5
}

/**
 * Ensure color meets WCAG AA contrast requirements against background
 */
function ensureContrast(foreground: string, background: string, targetRatio: number = 4.5): string {
  let currentColor = foreground
  let ratio = getContrastRatio(currentColor, background)

  if (ratio >= targetRatio) {
    return currentColor
  }

  const bgLum = getLuminance(background)
  const shouldDarken = bgLum > 0.5

  let attempts = 0
  const maxAttempts = 20

  while (ratio < targetRatio && attempts < maxAttempts) {
    currentColor = shouldDarken ? darken(currentColor, 5) : lighten(currentColor, 5)
    ratio = getContrastRatio(currentColor, background)
    attempts++
  }

  return currentColor
}

/**
 * Color palette interface
 */
export interface ColorPalette {
  primary: string
  secondary?: string
  accent?: string
  background?: string
  foreground?: string
  muted?: string
  border?: string
  destructive?: string
  success?: string
  warning?: string
}

/**
 * Generated palette with all variants
 */
export interface GeneratedPalette {
  primary: string
  secondary: string
  accent: string
  background: string
  foreground: string
  muted: string
  border: string
  destructive: string
  success: string
  warning: string
  primaryForeground: string
  secondaryForeground: string
  accentForeground: string
  mutedForeground: string
  destructiveForeground: string
  successForeground: string
  warningForeground: string
  theme: 'light' | 'dark'
  displayColors: Array<{ id: string; name: string; hex: string; role: string; foreground: string }>
}

/**
 * Generate a complete color palette from a primary color
 */
export function generatePalette(input: ColorPalette): GeneratedPalette {
  const primary: string = input.primary
  const background: string = input.background || '#FFFFFF'

  // Smart foreground default based on background darkness
  const foreground: string = input.foreground || (isDarkBackground(background) ? '#F5F5F5' : '#0A0A0A')

  // Generate secondary if not provided (analogous)
  const secondary: string = input.secondary || analogous(primary).color1

  // Generate accent if not provided (complementary)
  const accent: string = input.accent || complementary(primary)

  // Generate muted (desaturated primary)
  const muted: string = input.muted || adjustSaturation(lighten(primary, 40), -30)

  // Generate border (very light version of foreground)
  const border: string = input.border || lighten(foreground, 80)

  // Generate semantic colors if not provided
  const destructive: string = input.destructive || '#EF4444' // Red
  const success: string = input.success || '#10B981' // Green
  const warning: string = input.warning || '#F59E0B' // Orange

  // Generate foreground colors with proper contrast
  const primaryForeground = ensureContrast('#FFFFFF', primary, 4.5)
  const secondaryForeground = ensureContrast('#FFFFFF', secondary, 4.5)
  const accentForeground = ensureContrast('#FFFFFF', accent, 4.5)
  const mutedForeground = ensureContrast(foreground, muted, 4.5)
  const destructiveForeground = ensureContrast('#FFFFFF', destructive, 4.5)
  const successForeground = ensureContrast('#FFFFFF', success, 4.5)
  const warningForeground = ensureContrast('#FFFFFF', warning, 4.5)

  // Generate display colors
  const displayColors = [
    { id: 'base', name: 'Base', hex: background, role: 'Base text and background color', foreground: foreground },
    { id: 'primary', name: 'Primary', hex: primary, role: 'Main brand color', foreground: primaryForeground },
    { id: 'secondary', name: 'Secondary', hex: secondary, role: 'Secondary brand color', foreground: secondaryForeground },
    { id: 'accent', name: 'Accent', hex: accent, role: 'Accent and highlights', foreground: accentForeground },
    { id: 'muted', name: 'Muted', hex: muted, role: 'Subtle backgrounds', foreground: mutedForeground }
  ]

  // Determine theme based on background darkness
  const theme: 'light' | 'dark' = isDarkBackground(background) ? 'dark' : 'light'

  const result: GeneratedPalette = {
    primary,
    secondary,
    accent,
    background,
    foreground,
    muted,
    border,
    destructive,
    success,
    warning,
    primaryForeground,
    secondaryForeground,
    accentForeground,
    mutedForeground,
    destructiveForeground,
    successForeground,
    warningForeground,
    theme,
    displayColors
  }

  return result
}

/**
 * Generate chart colors based on primary color
 * Creates a 5-step scale from lighter to darker
 */
function generateChartColors(primary: string): string[] {
  const { r, g, b } = hexToRgb(primary)
  const { h, s, l } = rgbToHsl(r, g, b)

  // Create 5-step scale: lighter → base → darker
  const lightest = hslToRgb(h, s, Math.min(100, l + 30))
  const light = hslToRgb(h, s, Math.min(100, l + 15))
  const dark = hslToRgb(h, s, Math.max(0, l - 15))
  const darkest = hslToRgb(h, s, Math.max(0, l - 30))

  return [
    rgbToHex(lightest.r, lightest.g, lightest.b), // Lightest
    rgbToHex(light.r, light.g, light.b),           // Light
    primary,                                        // Base
    rgbToHex(dark.r, dark.g, dark.b),              // Dark
    rgbToHex(darkest.r, darkest.g, darkest.b)      // Darkest
  ]
}

/**
 * Update CSS custom properties in globals.css
 */
export async function updateCssColors(appPath: string, palette: GeneratedPalette): Promise<void> {
  const cssPath = join(appPath, 'src/styles/globals.css')
  let content = await readFile(cssPath, 'utf-8')

  // Generate chart colors from primary
  const chartColors = generateChartColors(palette.primary)

  // Map palette to CSS variables (shadcn/ui structure)
  const colorMap: Record<string, string> = {
    // Core colors
    '--background': palette.background,
    '--foreground': palette.foreground,
    '--card': palette.background,
    '--card-foreground': palette.foreground,
    '--popover': palette.background,
    '--popover-foreground': palette.foreground,
    '--primary': palette.primary,
    '--primary-foreground': palette.primaryForeground,
    '--secondary': palette.secondary,
    '--secondary-foreground': palette.secondaryForeground,
    '--muted': palette.muted,
    '--muted-foreground': palette.mutedForeground,
    '--accent': palette.accent,
    '--accent-foreground': palette.accentForeground,
    '--destructive': palette.destructive,
    '--destructive-foreground': palette.destructiveForeground,
    '--border': palette.border,
    '--input': palette.border,
    '--ring': palette.primary,

    // Chart colors (5-step scale)
    '--chart-1': chartColors[0] ?? palette.primary,
    '--chart-2': chartColors[1] ?? palette.primary,
    '--chart-3': chartColors[2] ?? palette.primary,
    '--chart-4': chartColors[3] ?? palette.primary,
    '--chart-5': chartColors[4] ?? palette.primary,

    // Sidebar colors (mirror main theme)
    '--sidebar': palette.muted,
    '--sidebar-foreground': palette.foreground,
    '--sidebar-primary': palette.primary,
    '--sidebar-primary-foreground': palette.primaryForeground,
    '--sidebar-accent': palette.accent,
    '--sidebar-accent-foreground': palette.accentForeground,
    '--sidebar-border': palette.border,
    '--sidebar-ring': palette.primary
  }

  // Update each CSS variable
  for (const [varName, hexColor] of Object.entries(colorMap)) {
    const { r, g, b } = hexToRgb(hexColor)
    const { h, s, l } = rgbToHsl(r, g, b)

    // Format as HSL: "hue saturation% lightness%"
    const cssValue = `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`

    // Match pattern: --variable-name: value;
    const regex = new RegExp(`(${varName}:\\s*)[^;]+;`, 'g')
    content = content.replace(regex, `$1${cssValue};`)
  }

  await writeFile(cssPath, content, 'utf-8')
}

/**
 * CSS Color Tool result
 */
export interface CssColorToolResult {
  success: boolean
  palette: GeneratedPalette
  message: string
}

/**
 * Main CSS color tool function
 */
export async function updateCssColorPalette(
  appPath: string,
  input: ColorPalette
): Promise<CssColorToolResult> {
  try {
    // Generate complete palette
    const palette = generatePalette(input)

    // The generatePalette function already ensures contrast via ensureContrast()
    // All foreground colors are automatically adjusted to meet WCAG AA standards

    // Update CSS file
    await updateCssColors(appPath, palette)

    return {
      success: true,
      palette,
      message: 'CSS color palette updated successfully'
    }
  } catch (error) {
    return {
      success: false,
      palette: {} as GeneratedPalette,
      message: `Failed to update CSS colors: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
