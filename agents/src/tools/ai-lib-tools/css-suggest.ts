import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { generatePalette, type ColorPalette } from '../css-color-tool.js'

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
export const cssSuggestAITool: Tool = createTool(
  `Generate DIVERSE color palette suggestions with BOTH light and dark variations.

This tool is optimized for showing color options to users. It:
- Generates 2-6 complete palettes in a single call
- Automatically renders a visual grid of all palettes
- Uses intelligent color generation (analogous, complementary, color theory)
- Returns data ready for the user to choose from

BEST PRACTICES FOR VARIETY:
1. For generic requests (e.g., "purple website"):
   - Generate 2 light palettes (white or near-white backgrounds)
   - Generate 2 dark palettes (mix of neutral dark + colored dark backgrounds)

2. For "dark theme" requests:
   - Generate 4 dark palettes with DIVERSE background colors
   - Mix neutral blacks/grays with COLORED dark backgrounds
   - Example: dark purple (#1a0a1f), dark blue (#0a1420), dark brown (#1a0f0a), charcoal (#1a1a1a)

3. For "light theme" requests:
   - Generate 4 light palettes with varied brightness and subtle tints

CREATING DARK THEME VARIETY (IMPORTANT):
- Dark backgrounds should be DIVERSE - not all black/gray!
- Neutral dark: #0A0A0A (true black), #1A1A1A (soft dark), #2A2A2A (charcoal)
- Colored dark: Very dark versions of primary color (lightness 5-12%)
  * Dark purple: #1a0a1f, #31133a, #41194d
  * Dark blue: #0a1420, #18304e, #2a5589
  * Dark brown: #1a0f0a, #25150e, #4a2a1c
  * Dark green: #0a1a0f, #0e2515, #003300
  * Dark red: #1a0a0a, #4d1300, #200a0f
- Match colored dark backgrounds with appropriate primary colors
- Colored dark themes create richer, more unique aesthetics

LIGHT THEME VARIETY:
- Vary background colors for each palette:
  * Pure: #FFFFFF (pure white)
  * Tinted: #FAFAFA (off-white), #F5F5F5 (very light gray)
  * Colored subtle: Very light tints of primary (lightness 90-98%)
- Adjust primary colors to work well on their backgrounds

Each palette requires:
- name: Descriptive name that indicates style (e.g., "Vibrant Purple Light", "Deep Purple Dark")
- primary: Primary brand color in hex format (e.g., #9333EA)
- background (optional): Background color (defaults to white if not specified)

The tool will automatically:
- Generate secondary, accent, muted colors using color theory
- Choose appropriate foreground text color based on background darkness
- Ensure all colors meet WCAG AA contrast requirements`,
  z.object({
    palettes: z.array(z.object({
      name: z.string().describe('Descriptive name for the palette (e.g., "Vibrant Purple Light", "Deep Purple Dark")'),
      primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).describe('Primary brand color (hex format, e.g., #9333EA)'),
      background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Background color (hex format). Use #FFFFFF for light, #0A0A0A for dark, etc.'),
      secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Secondary color (auto-generated if not provided)'),
      accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Accent color (auto-generated if not provided)'),
    })).min(2).max(6).describe('Array of 2-6 palette suggestions to generate. Include variety: 2 light + 2 dark for generic requests.')
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
      const palettesToStore = generatedPalettes.map(function mapPalette(paletteData) {
        return {
          name: paletteData.name,
          ...paletteData.palette
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

