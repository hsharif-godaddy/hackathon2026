import { createTool, type Tool } from '@airo/ai-lib'
import { updateCssColorPalette, generatePalette, type ColorPalette } from '../css-color-tool.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { appPlanTool } from '../app-plan-tool.js'
import { logger } from '../../logging/index.js'
import { z } from 'zod'

const appRepo = new AppRepository()

/**
 * Format palette for widget display
 */
function formatPaletteForWidget(palette: ReturnType<typeof generatePalette>, name: string) {
  return {
    name,
    theme: palette.theme,
    // Include complete palette for accurate preview (matches updateCssColors exactly)
    palette: {
      primary: palette.primary,
      primaryForeground: palette.primaryForeground,
      secondary: palette.secondary,
      secondaryForeground: palette.secondaryForeground,
      accent: palette.accent,
      accentForeground: palette.accentForeground,
      background: palette.background,
      foreground: palette.foreground,
      muted: palette.muted,
      mutedForeground: palette.mutedForeground,
      border: palette.border,
      destructive: palette.destructive,
      destructiveForeground: palette.destructiveForeground,
      success: palette.success,
      successForeground: palette.successForeground,
      warning: palette.warning,
      warningForeground: palette.warningForeground,
      chart1: palette.chart1,
      chart2: palette.chart2,
      chart3: palette.chart3,
      chart4: palette.chart4,
      chart5: palette.chart5
    }
  }
}

/**
 * CSS Color Tool for AI-Lib
 *
 * Programmatically updates CSS color variables with intelligent color generation
 * and contrast checking. Much faster than using str_replace_based_edit_tool for CSS updates.
 */
export const cssColorAITool: Tool = createTool(
  `Update CSS color palette programmatically with intelligent color generation.

This tool is MUCH FASTER than using str_replace_based_edit_tool for CSS color updates. It:
- Can apply a previously suggested palette by name (from cssSuggest)
- Generates missing colors using color theory algorithms (analogous, complementary, triadic)
- Ensures WCAG AA contrast compliance (4.5:1 ratio)
- Automatically generates foreground colors for each background
- Updates all CSS custom properties in one operation
- Returns the 6 most important colors for display

TWO WAYS TO USE:
1. Apply by name: If user selected a palette from cssSuggest, just provide paletteName
2. Custom colors: Provide paletteName + primary (and optionally other colors)

Color Generation Algorithms:
- Secondary: Analogous color (30° on color wheel)
- Accent: Complementary color (180° on color wheel)
- Muted: Desaturated and lightened primary
- Semantic colors: Pre-optimized red/green/orange for errors/success/warnings

Use this tool instead of str_replace_based_edit_tool when updating color schemes!`,
  z.object({
    paletteName: z.string().describe('Name for the color palette (e.g., "Ocean Blue", "Forest Green"). If this matches a suggested palette name, colors will be retrieved automatically.'),
    primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Primary brand color (hex format, e.g., #3B82F6). Optional if paletteName matches a suggested palette.'),
    secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Secondary brand color (auto-generated if not provided)'),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Accent color (auto-generated if not provided)'),
    background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Background color (default: #FFFFFF)'),
    foreground: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Foreground/text color (default: #000000)'),
    muted: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Muted/subtle color (auto-generated if not provided)'),
    border: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Border color (auto-generated if not provided)'),
    destructive: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Error/destructive color (default: #EF4444)'),
    success: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Success color (default: #10B981)'),
    warning: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Warning color (default: #F59E0B)'),
    generateOnly: z.boolean().optional().describe('If true, only generate the palette without updating CSS. Returns widget data for display.')
  }),
  async (input, context) => {
    const paletteName = input.paletteName
    let paletteInput = input as ColorPalette

    // Try to retrieve palette from session state first (optional)
    const sessionId = context?.metadata?.sessionId as string | undefined
    const stateManager = context?.metadata?.stateManager as any

    if (sessionId && stateManager?.getSuggestedPalette) {
      const suggestedPalette = stateManager.getSuggestedPalette(sessionId, paletteName)
      if (suggestedPalette) {
        logger.info('cssColor.palette.restored', {
          sessionId,
          paletteName,
          primary: suggestedPalette.primary,
          keys: Object.keys(suggestedPalette)
        })
        // Use suggested palette directly - don't allow overrides from input
        // This ensures the exact palette from cssSuggest is applied
        paletteInput = suggestedPalette as ColorPalette
      }
    }

    // If no suggested palette found, check if we have a primary color to work with
    if (!paletteInput.primary) {
      throw new Error('Primary color is required. Please provide primary color or use cssSuggest first to generate palettes.')
    }

    // Generate-only mode: just create the palette without updating CSS
    if (input.generateOnly) {
      const palette = generatePalette(paletteInput)
      const widgetData = formatPaletteForWidget(palette, paletteName)

      return {
        success: true,
        message: `Generated palette: ${paletteName}`,
        widget: widgetData,
        palette: widgetData.palette,
        theme: widgetData.theme
      }
    }

    // Normal mode: update CSS
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for CSS color updates')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const result = await updateCssColorPalette(app.path, paletteInput)

    if (!result.success) {
      throw new Error(result.message)
    }

    // Store color scheme in app plan for context
    try {
      await appPlanTool.execute({
        appId,
        operation: 'update',
        colorPalette: {
          name: paletteName,
          ...result.palette
        }
      })
      logger.info('cssColor.palette.saved', {
        appId,
        paletteName,
        primary: result.palette.primary
      })
    } catch (error) {
      // Log but don't fail if app plan update fails
      logger.warn('cssColor.appPlan.update.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // Format response for agent
    const response = `CSS color palette updated successfully!\n\n` +
      `Main Colors:\n` +
      `- Background: ${result.palette.background}\n` +
      `- Foreground: ${result.palette.foreground}\n` +
      `- Primary: ${result.palette.primary}\n` +
      `- Secondary: ${result.palette.secondary}\n` +
      `- Accent: ${result.palette.accent}\n` +
      `- Muted: ${result.palette.muted}\n\n` +
      `All CSS variables updated:\n` +
      `- Core colors: Primary, Secondary, Accent, Background, Foreground, Muted, Border\n` +
      `- Extended colors: Card, Popover, Input, Ring, Destructive\n` +
      `- Chart colors: 5-step scale for data visualization\n` +
      `- Sidebar colors: Complete sidebar theme\n` +
      `- All foreground colors automatically adjusted for WCAG AA contrast`

    return {
      success: true,
      message: response,
      paletteName,
      palette: {
        primary: result.palette.primary,
        primaryForeground: result.palette.primaryForeground,
        secondary: result.palette.secondary,
        secondaryForeground: result.palette.secondaryForeground,
        accent: result.palette.accent,
        accentForeground: result.palette.accentForeground,
        background: result.palette.background,
        foreground: result.palette.foreground,
        muted: result.palette.muted,
        mutedForeground: result.palette.mutedForeground,
        border: result.palette.border,
        destructive: result.palette.destructive,
        destructiveForeground: result.palette.destructiveForeground,
        success: result.palette.success,
        successForeground: result.palette.successForeground,
        warning: result.palette.warning,
        warningForeground: result.palette.warningForeground,
        chart1: result.palette.chart1,
        chart2: result.palette.chart2,
        chart3: result.palette.chart3,
        chart4: result.palette.chart4,
        chart5: result.palette.chart5
      },
      theme: result.palette.theme
    }
  }
)
