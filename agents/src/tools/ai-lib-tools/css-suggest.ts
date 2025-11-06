import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { generatePalette, type ColorPalette } from '../css-color-tool.js'

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
 * CSS Suggest Tool for AI-Lib
 * 
 * Generates multiple color palette suggestions in a single call and automatically
 * displays them in a grid widget. Much faster than calling cssColor multiple times.
 * 
 * This tool:
 * - Generates 2-6 complete palettes in one operation
 * - Automatically renders a color-palette-grid widget
 * - Uses the same color generation algorithms as cssColor
 * - Returns data ready for user selection
 * 
 * Use this when showing multiple palette options to users.
 */
export const cssSuggestAITool = createTool(
  `Generate multiple color palette suggestions and display them in a grid.

This tool is optimized for showing color options to users. It:
- Generates 2-6 complete palettes in a single call
- Automatically renders a visual grid of all palettes
- Uses intelligent color generation (analogous, complementary, triadic)
- Returns data ready for the user to choose from

Each palette requires:
- name: Descriptive name (e.g., "Ocean Blue", "Forest Green")
- primary: Primary brand color in hex format (e.g., #3B82F6)

The tool will automatically generate secondary, accent, muted, and semantic colors
for each palette using color theory algorithms.

Use this instead of calling cssColor multiple times when showing options!`,
  z.object({
    palettes: z.array(z.object({
      name: z.string().describe('Descriptive name for the palette (e.g., "Ocean Blue", "Sunset Orange")'),
      primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).describe('Primary brand color (hex format, e.g., #3B82F6)'),
      secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Secondary color (auto-generated if not provided)'),
      accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Accent color (auto-generated if not provided)'),
    })).min(2).max(6).describe('Array of 2-6 palette suggestions to generate')
  }),
  async (input, context) => {
    // Generate all palettes
    const generatedPalettes = input.palettes.map(function generateSinglePalette(paletteInput) {
      const palette = generatePalette(paletteInput as ColorPalette)
      return formatPaletteForWidget(palette, paletteInput.name)
    })

    // Store palettes in session state for later retrieval
    const sessionId = context?.metadata?.sessionId as string | undefined
    const stateManager = context?.metadata?.stateManager as any
    
    if (sessionId && stateManager?.storeSuggestedPalettes) {
      const palettesToStore = input.palettes.map(function mapPalette(p) {
        return {
          name: p.name,
          primary: p.primary,
          secondary: p.secondary,
          accent: p.accent
        }
      })
      stateManager.storeSuggestedPalettes(sessionId, palettesToStore)
    }

    // Return widget data for automatic rendering
    return {
      success: true,
      message: `Generated ${generatedPalettes.length} color palette suggestions`,
      widget: {
        widgetType: 'color-palette-grid',
        widgetData: {
          palettes: generatedPalettes
        }
      },
      palettes: generatedPalettes
    }
  }
)

