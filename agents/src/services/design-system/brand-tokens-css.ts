import type { WorkspaceFiles } from '../../workspace/files.js'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { buildGoogleFontsUrl } from '../../tools/ai-lib-tools/font-theme.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'brand-tokens-css' })

/** Convert "#rrggbb" to space-separated "H S% L%" (shadcn/globals.css format). */
function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '0 0% 0%'
  const r = parseInt(result[1]!, 16) / 255
  const g = parseInt(result[2]!, 16) / 255
  const b = parseInt(result[3]!, 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

// palette key (memory) -> CSS var name. Mirrors DevelopmentMode.applyThemePreview.
const COLOR_VAR_MAP: Array<[string, string]> = [
  ['background', '--background'], ['foreground', '--foreground'],
  ['card', '--card'], ['cardForeground', '--card-foreground'],
  ['primary', '--primary'], ['primaryForeground', '--primary-foreground'],
  ['secondary', '--secondary'], ['secondaryForeground', '--secondary-foreground'],
  ['muted', '--muted'], ['mutedForeground', '--muted-foreground'],
  ['accent', '--accent'], ['accentForeground', '--accent-foreground'],
  ['destructive', '--destructive'], ['destructiveForeground', '--destructive-foreground'],
  ['border', '--border'], ['border', '--input'], ['primary', '--ring'],
  ['chart1', '--chart-1'], ['chart2', '--chart-2'], ['chart3', '--chart-3'],
  ['chart4', '--chart-4'], ['chart5', '--chart-5'],
]

type PaletteLike = Record<string, unknown>
type TypographyLike = { heading?: { family?: string; weights?: string[] }; body?: { family?: string; weights?: string[] } }

/**
 * Escape a font-family name for safe interpolation inside a double-quoted CSS
 * string. Backslash-escapes `\` and `"` — a stray `"` would otherwise close the
 * string and let an (unvalidated) family name inject into the `:root` block —
 * and collapses newlines, which are invalid inside a CSS string. The fonts route
 * fails open on a Google Fonts network error, so the family value can reach here
 * unvalidated; this is the guard on it.
 */
function cssQuoteFontFamily(family: string): string {
  return family.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')
}

export function buildBrandTokensCss(palette: PaletteLike | undefined, typography: TypographyLike | undefined): string {
  const lines: string[] = []

  // Font @import (top of file, before :root)
  const fonts: Array<{ name: string; weights: string[] }> = []
  if (typography?.heading?.family) fonts.push({ name: typography.heading.family, weights: typography.heading.weights ?? ['400', '700'] })
  if (typography?.body?.family) fonts.push({ name: typography.body.family, weights: typography.body.weights ?? ['400'] })
  if (fonts.length > 0) lines.push(`@import url('${buildGoogleFontsUrl(fonts)}');`, '')

  const rootLines: string[] = []
  if (palette) {
    for (const [paletteKey, cssVar] of COLOR_VAR_MAP) {
      const hex = palette[paletteKey]
      if (typeof hex === 'string' && /^#?[a-f\d]{6}$/i.test(hex)) {
        rootLines.push(`  ${cssVar}: ${hexToHsl(hex)};`)
      }
    }
  }
  if (typography?.heading?.family) {
    rootLines.push(`  --font-heading: "${cssQuoteFontFamily(typography.heading.family)}", ui-sans-serif, system-ui, sans-serif;`)
  }
  if (typography?.body?.family) {
    rootLines.push(`  --font-sans: "${cssQuoteFontFamily(typography.body.family)}", ui-sans-serif, system-ui, sans-serif;`)
  }

  lines.push(':root {', ...rootLines, '}', '')
  return lines.join('\n')
}

/** Read palette + typography from memory and write public/brand-tokens.css. */
export async function syncBrandTokensCss(
  appId: string,
  customerId: string | undefined,
  files: WorkspaceFiles,
): Promise<void> {
  const memory = getKvMemoryStore()
  const scope = workspaceScopeFromAppId(appId, customerId)
  const [paletteRes, typoRes] = await Promise.all([
    memory.get(scope, 'brand.colors.palette'),
    memory.get(scope, 'brand.typography'),
  ])
  const palette = paletteRes.exists ? (paletteRes.value as PaletteLike) : undefined
  const typography = typoRes.exists ? (typoRes.value as TypographyLike) : undefined
  const css = buildBrandTokensCss(palette, typography)
  try {
    await files.write({ path: 'public/brand-tokens.css', content: css })
  } catch (error) {
    logger.warn('brandTokensCss.write.failed', { appId, error: error instanceof Error ? error.message : String(error) })
  }
}
