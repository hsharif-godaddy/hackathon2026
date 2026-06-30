import type { WorkspaceFiles } from '../workspace/files.js'
import { logger } from '../logging/index.js'

/**
 * Color manipulation utilities
 */

/**
 * Parse hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Expand 3-digit shorthand (#fff -> #ffffff). The old 6-digit-only regex rejected
  // valid 3-digit hex and threw — which upstream blanked the saved palette. Accept it.
  const cleaned = typeof hex === 'string' ? hex.trim().replace(/^#/, '') : ''
  const full = /^[a-f\d]{3}$/i.test(cleaned)
    ? cleaned.split('').map(function double(c) { return c + c }).join('')
    : cleaned
  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(full)
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
export function getLuminance(hex: string): number {
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
export function getContrastRatio(color1: string, color2: string): number {
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
  mutedForeground?: string
  border?: string
  card?: string
  cardForeground?: string
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
  mutedForeground: string
  border: string
  card: string
  cardForeground: string
  destructive: string
  success: string
  warning: string
  primaryForeground: string
  secondaryForeground: string
  accentForeground: string
  destructiveForeground: string
  successForeground: string
  warningForeground: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
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

  // Muted FILL (desaturated, theme-aware). Deterministic: a random strategy made
  // palettes vary run-to-run for the same input (AIROBUILD-2976). Pick one stable
  // strategy per theme so kit / customer / auto-select builds are reproducible.
  const muted: string = input.muted || (
    isDarkBackground(background)
      ? adjustSaturation(darken(primary, 35), -40)   // Colored subtle
      : adjustSaturation(lighten(primary, 40), -30)  // Classic light subtle
  )

  // Border (theme-aware). Deterministic for the same reason as muted above.
  const border: string = input.border || (
    isDarkBackground(background)
      ? adjustSaturation(lighten(background, 20), -10) // Subtle gray, lighter than background
      : adjustSaturation(darken(background, 15), -5)   // Subtle gray, darker than background
  )

  // Generate semantic colors if not provided
  const destructive: string = input.destructive || '#EF4444' // Red
  const success: string = input.success || '#10B981' // Green
  const warning: string = input.warning || '#F59E0B' // Orange

  // Card colors - use provided or default to background/foreground
  const card: string = input.card || background
  const cardForeground: string = input.cardForeground || ensureContrast(foreground, card, 4.5)

  // Generate foreground colors with proper contrast
  const primaryForeground = ensureContrast('#FFFFFF', primary, 4.5)
  const secondaryForeground = ensureContrast('#FFFFFF', secondary, 4.5)
  const accentForeground = ensureContrast('#FFFFFF', accent, 4.5)
  // Low-emphasis text renders on the page / card surface, NOT on the muted fill,
  // so its contrast must be checked against that surface (AIROBUILD-2976: the old
  // `ensureContrast(foreground, muted, 4.5)` left muted text failing AA on white).
  // Check against the WORST-CASE surface so the single muted color passes on both
  // background and card: a light theme has dark text, so the darker surface is
  // worst; a dark theme has light text, so the lighter surface is worst. Start
  // from a muted mid-tone (~45 lightness off the surface) that ensureContrast then
  // nudges just enough to clamp to AA — so the text stays visibly low-emphasis
  // without dropping below 4.5:1.
  const isDarkTheme: boolean = isDarkBackground(background)
  const mutedTextSurface: string = isDarkTheme
    ? (getLuminance(background) >= getLuminance(card) ? background : card)
    : (getLuminance(background) <= getLuminance(card) ? background : card)
  const mutedTextBase: string = isDarkTheme
    ? lighten(mutedTextSurface, 45)
    : darken(mutedTextSurface, 45)
  const mutedForegroundColor = input.mutedForeground || ensureContrast(mutedTextBase, mutedTextSurface, 4.5)
  const destructiveForeground = ensureContrast('#FFFFFF', destructive, 4.5)
  const successForeground = ensureContrast('#FFFFFF', success, 4.5)
  const warningForeground = ensureContrast('#FFFFFF', warning, 4.5)

  // Generate chart colors (5-step scale from lighter to darker)
  const chartColors = generateChartColors(primary)

  // Generate display colors
  const displayColors = [
    { id: 'base', name: 'Base', hex: background, role: 'Base text and background color', foreground: foreground },
    { id: 'primary', name: 'Primary', hex: primary, role: 'Main brand color', foreground: primaryForeground },
    { id: 'secondary', name: 'Secondary', hex: secondary, role: 'Secondary brand color', foreground: secondaryForeground },
    { id: 'accent', name: 'Accent', hex: accent, role: 'Accent and highlights', foreground: accentForeground },
    { id: 'muted', name: 'Muted', hex: muted, role: 'Subtle backgrounds', foreground: mutedForegroundColor }
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
    mutedForeground: mutedForegroundColor,
    border,
    card,
    cardForeground,
    destructive,
    success,
    warning,
    primaryForeground,
    secondaryForeground,
    accentForeground,
    destructiveForeground,
    successForeground,
    warningForeground,
    chart1: chartColors[0] ?? primary,
    chart2: chartColors[1] ?? primary,
    chart3: chartColors[2] ?? primary,
    chart4: chartColors[3] ?? primary,
    chart5: chartColors[4] ?? primary,
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

/** Own enumerable entries with a non-null/undefined value. Used to overlay a caller's
 *  explicitly-set palette fields onto a generated base without letting `undefined`
 *  holes punch through (which would later throw in updateCssColors). */
function definedOnly(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v
  }
  return out
}

/**
 * Update CSS custom properties in globals.css
 */
export async function updateCssColors(files: WorkspaceFiles, palette: GeneratedPalette): Promise<void> {
  const cssRelativePath = 'src/styles/globals.css'
  const viewResult = await files.view({ path: cssRelativePath })
  let content = viewResult.content

  // Map palette to CSS variables (shadcn/ui structure)
  const colorMap: Record<string, string> = {
    // Core colors
    '--background': palette.background,
    '--foreground': palette.foreground,
    '--card': palette.card,
    '--card-foreground': palette.cardForeground,
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

    // Chart colors (from palette)
    '--chart-1': palette.chart1,
    '--chart-2': palette.chart2,
    '--chart-3': palette.chart3,
    '--chart-4': palette.chart4,
    '--chart-5': palette.chart5,

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

  // Update each CSS variable. A single malformed/undefined value must NOT abort the
  // whole write — that throw is what upstream turned into a blanked, name-only palette.
  // Skip the bad var (leaving the prior globals.css value) and record it.
  const skipped: string[] = []
  for (const [varName, hexColor] of Object.entries(colorMap)) {
    let rgb: { r: number; g: number; b: number }
    try {
      rgb = hexToRgb(hexColor)
    } catch {
      skipped.push(`${varName}=${String(hexColor)}`)
      continue
    }
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)

    // Format as HSL: "hue saturation% lightness%"
    const cssValue = `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`

    // Match pattern: --variable-name: value;
    const regex = new RegExp(`(${varName}:\\s*)[^;]+;`, 'g')
    content = content.replace(regex, `$1${cssValue};`)
  }

  if (skipped.length > 0) {
    logger.warn('cssColorTool.updateCssColors.skipped_invalid', { count: skipped.length, vars: skipped })
  }

  await files.write({ path: cssRelativePath, content })
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
  files: WorkspaceFiles,
  input: ColorPalette
): Promise<CssColorToolResult> {
  try {
    // Check if input is already a complete generated palette (from session state).
    // GeneratedPalette has foreground colors and theme property, ColorPalette doesn't.
    const inputAny = input as unknown as Record<string, unknown>
    const isCompletePalette = !!(inputAny.primaryForeground && inputAny.theme)

    // Even a "complete" palette can be missing newer fields (charts, other foregrounds,
    // card, border) — and a single undefined field throws in updateCssColors, blanking
    // the palette upstream. generatePalette fills EVERY field; overlay the caller's
    // explicitly-set values so a complete palette is preserved exactly while gaps fill.
    const base = generatePalette(input)
    const palette: GeneratedPalette = isCompletePalette
      ? ({ ...base, ...definedOnly(inputAny) } as GeneratedPalette)
      : base

    // Update CSS file
    await updateCssColors(files, palette)

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
