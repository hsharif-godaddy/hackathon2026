import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

/**
 * Color information schema
 */
const colorInfoSchema = z.object({
  name: z.string().describe('Display name of the color'),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).describe('Hexadecimal color code (e.g., #8B7B6B)'),
  role: z.string().optional().describe('Optional description of color purpose (e.g., "Primary", "Accent")')
})

/**
 * Color palette widget schema
 */
const colorPaletteSchema = z.object({
  type: z.literal('color-palette').describe('Widget type identifier'),
  name: z.string().optional().describe('Optional name for the color palette'),
  colors: z.array(colorInfoSchema).min(1).max(10).describe('Array of colors (minimum 1, maximum 10)')
})

/**
 * Font information schema
 */
const fontInfoSchema = z.object({
  name: z.string().describe('Google Font name (e.g., "Inter", "Playfair Display")'),
  weight: z.union([z.string(), z.number()]).optional().describe('Font weight (e.g., "400", "600", "700")'),
  category: z.string().optional().describe('Font category (e.g., "sans-serif", "serif", "monospace")'),
  fallback: z.string().optional().describe('Fallback font family (default: "sans-serif")'),
  description: z.string().optional().describe('Brief description of the font and when to use it (1-2 sentences)')
})

/**
 * Typography widget schema
 */
const typographySchema = z.object({
  type: z.literal('typography').describe('Widget type identifier'),
  name: z.string().optional().describe('Optional name for the typography system'),
  fonts: z.array(fontInfoSchema).min(1).max(5).describe('Array of Google Fonts (minimum 1, maximum 5)')
})

/**
 * Widget data union schema - add more widget types here
 */
const widgetDataSchema = z.union([
  colorPaletteSchema,
  typographySchema
])

/**
 * Widget Render Tool for AI-Lib
 * 
 * Renders interactive widgets in the agent response stream.
 * Supports multiple widget types for rich visual responses.
 */
export const widgetRenderAITool = createTool(
`Render an interactive widget in your response.
Each widget must be defined in the widgetDataSchema.
Supports:
- color-palette: Display color schemes with previews
- typography: Display Google Fonts with sample text
`,
  z.object({
    widget: widgetDataSchema.describe('Widget configuration data')
  }),
  async (input) => {
    const { widget } = input
    
    // Validate widget data
    if (!widget || typeof widget !== 'object') {
      throw new Error('Invalid widget data provided')
    }
    
    // Return structured widget data that will be handled by the frontend
    // The WebSocket server will transform this into a widget segment
    const widgetName = 'name' in widget && widget.name ? ` - ${widget.name}` : ''
    
    return {
      success: true,
      widgetType: widget.type,
      widgetData: widget,
      message: `Widget rendered: ${widget.type}${widgetName}`
    }
  }
)

