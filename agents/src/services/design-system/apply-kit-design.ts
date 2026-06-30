import { createForWorkspace } from '../../workspace/index.js'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { updateCssColorPalette, type ColorPalette } from '../../tools/css-color-tool.js'
import { updateCssFontVariables } from '../../tools/ai-lib-tools/font-theme.js'
import { syncBrandTokensCss } from './brand-tokens-css.js'
import { logger } from '../../logging/index.js'
import type { FontCategory } from '@airo/shared/fonts'
import type { DesignKitDesign, DesignKitPalette, DesignKitFont } from './types.js'

/**
 * Deterministically apply a design kit's structured palette + fonts to the app,
 * bypassing the LLM agent entirely.
 *
 * Why this exists: the agent reliably IGNORES a "please apply the kit's colors"
 * prompt directive — it re-derives a palette from the business domain (observed:
 * "coffee shop" → terracotta, ignoring the attached dark "Obsidian" kit even with
 * the kit's primitives loaded in context). The fix is to stop asking and apply the
 * kit in code: this writes the same CSS + memory the colorScheme/fontTheme tools
 * write, so the result is indistinguishable from a (faithful) tool call, and the
 * tools are then removed from the kit-attached agent so it can't override.
 *
 * Reuses the low-level writers `updateCssColorPalette` (color-scheme's CSS path)
 * and `updateCssFontVariables` (font-theme's CSS path) so the styling path is
 * identical to the agent-driven one. Best-effort throughout — a failure here must
 * never block the build; we log and move on.
 */

/** Strip the CSS family declaration down to the bare family name for Google Fonts
 *  loading, e.g. `'Sora', system-ui, sans-serif` → `Sora`. */
export function extractFontFamilyName(cssFamily: string): string {
  const first = cssFamily.split(',')[0] ?? cssFamily
  return first.trim().replace(/^['"]|['"]$/g, '').trim()
}

/** Infer a Google-Fonts category from the kit's fallback hint (the generic family
 *  keyword the catalog appends, e.g. `…, sans-serif`). Falls back to sans-serif. */
export function inferFontCategory(cssFamily: string): FontCategory {
  const lower = cssFamily.toLowerCase()
  if (/\bmonospace\b/.test(lower) || /\bui-monospace\b/.test(lower)) return 'monospace'
  if (/\bcursive\b/.test(lower)) return 'cursive'
  if (/\bfantasy\b/.test(lower)) return 'fantasy'
  // Check sans-serif before serif — "sans-serif" contains "serif".
  if (/\bsans-serif\b/.test(lower)) return 'sans-serif'
  if (/\bserif\b/.test(lower)) return 'serif'
  return 'sans-serif'
}

/** Map the catalog's named palette fields onto the colorScheme `ColorPalette`
 *  input. Only named hex fields are mapped; `generatePalette` derives the rest
 *  (mutedForeground, card, etc.) from these, exactly as the agent-driven apply
 *  does. The kit's `tokens` bag is intentionally not mapped — those are
 *  kit-specific CSS vars with no stable colorScheme slot. */
export function mapKitPaletteToColorPalette(palette: DesignKitPalette): ColorPalette | undefined {
  const out: Partial<ColorPalette> = {}
  if (palette.primary) out.primary = palette.primary
  if (palette.background) out.background = palette.background
  if (palette.foreground) out.foreground = palette.foreground
  if (palette.secondary) out.secondary = palette.secondary
  if (palette.accent) out.accent = palette.accent
  if (palette.muted) out.muted = palette.muted
  if (palette.mutedForeground) out.mutedForeground = palette.mutedForeground
  if (palette.border) out.border = palette.border
  // primary is the one field generatePalette truly needs; without it we can't
  // build a coherent palette, so skip color apply entirely.
  if (!out.primary) return undefined
  return out as ColorPalette
}

function toFontInfo(font: DesignKitFont, fallbackWeights: string[]): { name: string; weights: string[]; category: FontCategory } {
  return {
    name: extractFontFamilyName(font.family),
    weights: font.weights && font.weights.length > 0 ? font.weights : fallbackWeights,
    category: inferFontCategory(font.family),
  }
}

export interface ApplyKitDesignResult {
  appliedColors: boolean
  appliedFonts: boolean
}

/**
 * Apply a kit's structured `design` block (palette + typography) to the app
 * workspace. Returns which parts were applied. Never throws.
 */
export async function applyKitDesignTokens(input: {
  appId: string
  design: DesignKitDesign | undefined
  displayName: string
  customerId?: string
}): Promise<ApplyKitDesignResult> {
  const { appId, design, displayName, customerId } = input
  const result: ApplyKitDesignResult = { appliedColors: false, appliedFonts: false }
  if (!design) return result

  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) {
    logger.warn('design_kit.apply.workspace_unavailable', { appId, displayName })
    return result
  }
  const memory = getKvMemoryStore()
  const scope = workspaceScopeFromAppId(appId, customerId)

  // --- Colors ---
  const paletteInput = design.palette ? mapKitPaletteToColorPalette(design.palette) : undefined
  if (paletteInput) {
    try {
      const applied = await updateCssColorPalette(workspace.files, paletteInput)
      if (applied.success) {
        await memory.set(scope, 'brand.colors.palette', { name: displayName, ...applied.palette })
        result.appliedColors = true
        logger.info('design_kit.apply.colors', { appId, displayName, primary: paletteInput.primary })
      } else {
        logger.warn('design_kit.apply.colors_failed', { appId, displayName, message: applied.message })
      }
    } catch (err) {
      logger.warn('design_kit.apply.colors_error', { appId, displayName, err: String(err) })
    }
  }

  // --- Fonts ---
  const display = design.typography?.display
  const body = design.typography?.body
  if (display || body) {
    try {
      // A kit may carry only one of display/body — reuse it for the missing slot
      // so headers and body still get the kit's font rather than a stale default.
      const headerSrc = display ?? body!
      const bodySrc = body ?? display!
      const headerFont = toFontInfo(headerSrc, ['400', '700'])
      const bodyFont = toFontInfo(bodySrc, ['400', '700'])
      const applied = await updateCssFontVariables(workspace.files, headerFont, bodyFont)
      if (applied.success) {
        await memory.set(scope, 'brand.typography', {
          name: displayName,
          heading: { family: headerFont.name, weights: headerFont.weights },
          body: { family: bodyFont.name, weights: bodyFont.weights },
        })
        result.appliedFonts = true
        logger.info('design_kit.apply.fonts', { appId, displayName, headerFont: headerFont.name, bodyFont: bodyFont.name })
      } else {
        logger.warn('design_kit.apply.fonts_failed', { appId, displayName, message: applied.message })
      }
    } catch (err) {
      logger.warn('design_kit.apply.fonts_error', { appId, displayName, err: String(err) })
    }
  }

  // Regenerate public/brand-tokens.css from the freshly-written memory so the
  // brand-token CSS stays consistent with globals.css.
  if (result.appliedColors || result.appliedFonts) {
    try {
      await syncBrandTokensCss(appId, customerId, workspace.files)
    } catch (err) {
      logger.warn('design_kit.apply.brand_tokens_sync_error', { appId, displayName, err: String(err) })
    }
  }

  return result
}
