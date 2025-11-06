import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { updateCssColorPalette, generatePalette, type ColorPalette } from '../css-color-tool.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { appPlanTool } from '../app-plan-tool.js'

const appRepo = new AppRepository()

/**
 * Format palette for widget display
 */
function formatPaletteForWidget(palette: ReturnType<typeof generatePalette>, name: string) {
  return {
    name,
    colors: palette.displayColors.map(function mapColor(c) {
      const fgKey = `${c.name.toLowerCase()}Foreground` as keyof typeof palette
      return {
        name: c.name,
        hex: c.hex,
        role: c.role,
        foreground: palette[fgKey] as string
      }
    })
  }
}

/**
 * CSS Color Tool for AI-Lib
 * 
 * Programmatically updates CSS color variables with intelligent color generation
 * and contrast checking. Much faster than using fileEdit for CSS updates.
 */
export const cssColorAITool = createTool(
  `Update CSS color palette programmatically with intelligent color generation.

This tool is MUCH FASTER than using fileEdit for CSS color updates. It:
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

Use this tool instead of fileEdit when updating color schemes!`,
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

    // Try to retrieve palette from session state if no primary color provided
    if (!input.primary) {
      const sessionId = context?.metadata?.sessionId as string | undefined
      const stateManager = context?.metadata?.stateManager as any

      if (sessionId && stateManager?.getSuggestedPalette) {
        const suggestedPalette = stateManager.getSuggestedPalette(sessionId, paletteName)
        
        if (suggestedPalette) {
          // Merge suggested palette with any provided overrides
          paletteInput = {
            ...suggestedPalette,
            ...input
          } as ColorPalette
          console.log(`[cssColor] Retrieved suggested palette "${paletteName}" from session`)
        } else {
          throw new Error(`Palette "${paletteName}" not found in suggested palettes. Please provide primary color or use cssSuggest first.`)
        }
      } else {
        throw new Error('Primary color is required when not using a suggested palette name')
      }
    }
    
    // Generate-only mode: just create the palette without updating CSS
    if (input.generateOnly) {
      const palette = generatePalette(paletteInput)
      
      return {
        success: true,
        message: `Generated palette: ${paletteName}`,
        widget: formatPaletteForWidget(palette, paletteName),
        palette: {
          primary: palette.primary,
          secondary: palette.secondary,
          accent: palette.accent,
          background: palette.background,
          success: palette.success
        }
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
          primary: result.palette.primary,
          secondary: result.palette.secondary,
          accent: result.palette.accent,
          background: result.palette.background,
          surface: result.palette.muted,
          text: result.palette.foreground,
          textSecondary: result.palette.mutedForeground,
          error: result.palette.destructive,
          warning: result.palette.warning || '#F59E0B',
          success: result.palette.success,
          info: result.palette.primary,
          scheme: 'light'
        }
      })
    } catch (error) {
      // Log but don't fail if app plan update fails
      console.warn('Failed to update app plan with color scheme:', error)
    }

    // Format response for agent
    let response = `✅ CSS color palette updated successfully!\n\n`
    
    // Show the 6 most important colors
    response += `**Display Colors:**\n`
    result.palette.displayColors.forEach(function formatColor(color) {
      response += `- ${color.name}: ${color.hex} (${color.role})\n`
    })
    
    response += `\n**All CSS variables updated:**\n`
    response += `- Core colors: Primary, Secondary, Accent, Background, Foreground, Muted, Border\n`
    response += `- Extended colors: Card, Popover, Input, Ring, Destructive\n`
    response += `- Chart colors: 5-step scale for data visualization\n`
    response += `- Sidebar colors: Complete sidebar theme\n`
    response += `- All foreground colors automatically adjusted for WCAG AA contrast\n`

    return {
      success: true,
      message: response,
      paletteName,
      displayColors: result.palette.displayColors,
      palette: {
        primary: result.palette.primary,
        secondary: result.palette.secondary,
        accent: result.palette.accent,
        muted: result.palette.muted,
        destructive: result.palette.destructive,
        success: result.palette.success
      }
    }
  }
)

