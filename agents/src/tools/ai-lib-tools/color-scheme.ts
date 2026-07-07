import { createTool, generateTextWithTracking, type Tool } from '@airo/ai-lib'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-grants'
import { z } from 'zod'

import { generatePalette, updateCssColorPalette, type ColorPalette } from '../css-color-tool.js'
import { createForWorkspace } from '../../workspace/index.js'
import { extractBudgetContext, withBudgetFields, type ToolBudgetContext } from './tool-budget-context.js'

interface ColorPaletteGridWidget {
  widgetType: 'color-palette-grid'
  widgetData: {
    palettes: Array<{
      name: string
      theme: string
      palette: Record<string, string>
    }>
  }
}

interface ColorPaletteWidget {
  widgetType: 'color-palette'
  widgetData: {
    name: string
    palette: Record<string, string>
  }
}
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { kitTokensLocked } from '../../services/design-system/kit-tokens-locked.js'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'

import { appPlanTool } from '../app-plan-tool.js'
import { getAgentModelWithName } from '../../utils/model-selection.js'
import { logger } from '../../logging/index.js'

const appRepo = new AppRepository()
const memoryStore = getKvMemoryStore()

const COLOR_SCHEME_KIT_LOCKED_MESSAGE =
  "This app uses an attached design kit, so its palette is the default and automated recoloring is skipped. If the customer explicitly asked to change colors, honor it with 'apply' mode (use 'suggest' first if they want options); otherwise build on top of the kit's palette."

function formatPaletteForWidget(palette: ReturnType<typeof generatePalette>, name: string) {
  return {
    name,
    theme: palette.theme,
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
      card: palette.card,
      cardForeground: palette.cardForeground,
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

const COLOR_GENERATION_PROMPT = `You are an expert color scheme designer. Generate beautiful, accessible color palettes based on the user's request.

IMPORTANT: Return ONLY valid JSON. Do not include any markdown formatting, code blocks, or explanatory text.

Your response must be a JSON object with this exact structure:
{
  "palettes": [
    {
      "name": "Descriptive name (e.g., 'Vibrant Purple Light', 'Deep Ocean Dark')",
      "primary": "#RRGGBB",
      "background": "#RRGGBB"
    }
  ]
}

COLOR SELECTION GUIDELINES:

1. VARIETY - Create diverse palettes:
   - For generic requests: Mix 2 light + 2 dark themes
   - For "dark theme": 4 dark palettes with varied backgrounds (#0A0A0A, #1A1A1A, #2A2A2A, colored dark)
   - For "light theme": 4 light palettes with varied backgrounds (#FFFFFF, #FAFAFA, #F5F5F5, tinted)

2. DARK BACKGROUNDS - Use diverse dark colors:
   - Neutral: #0A0A0A (true black), #1A1A1A (soft dark), #2A2A2A (charcoal)
   - Colored dark (lightness 5-12%):
     * Dark purple: #1a0a1f, #31133a
     * Dark blue: #0a1420, #18304e
     * Dark brown: #1a0f0a, #25150e
     * Dark green: #0a1a0f, #0e2515

3. LIGHT BACKGROUNDS - Vary brightness:
   - Pure: #FFFFFF
   - Tinted: #FAFAFA, #F5F5F5
   - Colored subtle (lightness 90-98%)

4. PRIMARY COLORS - Choose vibrant, distinct colors that work well on their backgrounds

5. ACCESSIBILITY - Ensure colors meet WCAG AA contrast (4.5:1 ratio)

EXAMPLE OUTPUT:
{
  "palettes": [
    {"name": "Vibrant Purple Light", "primary": "#9333EA", "background": "#FFFFFF"},
    {"name": "Soft Lavender Light", "primary": "#A855F7", "background": "#FAFAFA"},
    {"name": "Deep Purple Dark", "primary": "#7C3AED", "background": "#0A0A0A"},
    {"name": "Rich Plum Dark", "primary": "#8B5CF6", "background": "#1A1A1A"}
  ]
}

Remember: Return ONLY the JSON object, no other text.`

async function generatePalettesWithLLM(
  description: string,
  count: number,
  theme: 'light' | 'dark' | 'both',
  appId?: string,
  sessionId?: string,
  agentId?: string,
  customTags?: string[],
  socketId?: string,
  subscriptionId?: string,
  customerId?: string,
  budgetContext?: ToolBudgetContext
): Promise<Array<{ name: string; primary: string; background: string }>> {
  const { model, modelName } = await getAgentModelWithName('fast')

  const userPrompt = `Generate ${count} color palette${count > 1 ? 's' : ''} for: ${description}

Theme preference: ${theme}

Return ONLY the JSON object with the palettes array. No markdown, no code blocks, no explanatory text.`

  const contextData: {
    appId?: string
    conversationId?: string
    description: string
    toolName: string
  } = {
    description: 'Color scheme generation',
    toolName: 'colorScheme'
  }
  
  if (appId) contextData.appId = appId
  if (sessionId) contextData.conversationId = sessionId

  const executionContext: ExecutionContext | undefined = (appId || sessionId || socketId) ? {
    socketId,
    metadata: withBudgetFields({
      appId,
      sessionId,
      agentId,
      subscriptionId,
      customerId,
    }, budgetContext)
  } : undefined

  // Additional tags to always include (tool-specific and custom)
  const additionalTags = ['source:tool-llm', 'source:color-scheme']
  if (customTags?.length) additionalTags.push(...customTags)

  // Build metadata using the grants-aware helper
  let litellmMetadata: LitellmMetadata | null = null
  if (executionContext) {
    litellmMetadata = buildLitellmMetadataFromContext(executionContext, {
      source: LlmCallSource.ToolColorScheme,
      agentId,
    })
  }

  // Merge additional tags into metadata from grants-aware helper
  if (litellmMetadata) {
    const mergedTags = [...new Set([...(litellmMetadata.tags || []), ...additionalTags])]
    litellmMetadata = { ...litellmMetadata, tags: mergedTags }
  }

  // Fallback to existing context if buildLitellmMetadataFromContext returned null
  // (feature flag off or no socketId available)
  if (!litellmMetadata) {
    const existingMetadata = llmMetadataContext.getStore()
    let userIdentifier = existingMetadata?.user
    if (!userIdentifier && appId) {
      const app = appRepo.findById(appId)
      userIdentifier = app?.subscriptionId || app?.customerId
    }
    const baseTags = ['source:tool-llm', 'source:color-scheme']
    if (agentId) baseTags.push(`agent:${agentId}`)
    if (customTags?.length) baseTags.push(...customTags)
    const mergedTags = [...new Set([...(existingMetadata?.tags || []), ...baseTags])]
    litellmMetadata = {
      ...(userIdentifier && { user: userIdentifier }),
      tags: mergedTags
    }
  }

  const result = await (litellmMetadata
    ? llmMetadataContext.run(litellmMetadata, async () => {
        return await generateTextWithTracking({
          model,
          modelName,
          system: COLOR_GENERATION_PROMPT,
          prompt: userPrompt,
          temperature: 0.8,
          context: contextData
        })
      })
    : generateTextWithTracking({
        model,
        modelName,
        system: COLOR_GENERATION_PROMPT,
        prompt: userPrompt,
        temperature: 0.8,
        context: contextData
      }))

  let cleanedText = result.text.trim()
  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  let parsed: any
  try {
    parsed = JSON.parse(cleanedText)
  } catch (error) {
    logger.error('colorScheme.llm.parse_error', {
      error: error instanceof Error ? error.message : String(error),
      textSnippet: cleanedText.substring(0, 200)
    })
    throw new Error(`Failed to parse LLM color palette response: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!parsed.palettes || !Array.isArray(parsed.palettes)) {
    logger.error('colorScheme.llm.invalid_structure', { parsed })
    throw new Error('LLM response missing palettes array')
  }

  return parsed.palettes.slice(0, count)
}

export const colorSchemeAITool: Tool = createTool(
  `Generate and apply color schemes for the application.

This tool has three modes:

**SET MODE** - Generate and apply one color palette directly:
- Uses AI to choose one palette based on the description
- Applies the palette immediately without showing options
- Use for automated flows, rebuilds, or initial setup
- IMPORTANT: set mode only honors primary + background from the description.
  Secondary, accent, muted, etc. are derived algorithmically by hue-shifting
  off the primary. If the design direction lists explicit hex values for
  secondary/accent/etc., DO NOT use set mode — use apply mode and pass each
  hex through verbatim, otherwise those colors will be discarded.

**SUGGEST MODE** - Generate color palette options:
- Uses AI to create diverse, beautiful color schemes
- Shows 2-6 palette options in a visual grid widget
- User can click "Apply" on any palette to use it

**APPLY MODE** - Apply a color palette to CSS:
- Apply a previously suggested palette by name
- Or provide explicit colors to apply directly
- Optionally provide semantic color overrides (card, muted, border, etc.)
- Updates all CSS color variables in one operation

WHEN TO USE SET MODE:
- Automated flows where you should choose and apply colors directly
- Initial build or rebuild flows where the design direction is described
  emotionally/qualitatively (no specific hex values listed)
- User asks you to pick colors rather than show options
- DO NOT use set mode when the spec lists specific hex values for any role
  beyond primary/background — set mode will discard them. Use apply mode
  instead and pass the hex values through.

WHEN TO USE SUGGEST MODE:
- User asks for color options: "show me some purple color schemes"
- User wants to explore: "what colors would work for a bakery?"
- User requests variety: "give me 4 dark theme options"
- IMPORTANT: Only suggest colors AFTER content exists - users need to see colors applied to actual UI

WHEN NOT TO USE SUGGEST MODE:
- At the start of a project before any content exists
- Before building the initial page/layout
- User should see colors on actual content, not empty pages

WHEN TO USE APPLY MODE:
- User selects a palette from the widget (by clicking "Apply")
- User specifies exact colors: "use #9333EA as primary"
- User requests a specific named theme: "apply the dracula theme"
- The design direction or build spec lists explicit hex values for any of
  primary/background/secondary/accent/muted — pass each one through so the
  palette matches the spec exactly. This is the right call for initial
  builds whenever the initial agent or user provided concrete hex values.

WORKFLOW FOR SET MODE (automated flows):
1. Agent: colorScheme({ mode: 'set', description: 'warm purple tones for bakery' })
2. Tool generates ONE palette and applies it immediately
3. Tool confirms which palette was applied
4. No user interaction needed

WORKFLOW FOR SUGGEST MODE (interactive flows):
1. User: "Change colors to purple"
2. You: colorScheme({ mode: 'suggest', description: 'purple color scheme', count: 4 })
3. Tool returns widget with 4 purple palette options
4. User clicks "Apply" on option 2
5. You: colorScheme({ mode: 'apply', paletteName: 'Soft Purple Light' })
6. Tool updates CSS and confirms

CRITICAL OUTPUT RULES:
- After calling suggest mode: DO NOT describe the palettes or list them - the widget shows them visually
- After calling suggest mode: DO NOT output any text - the tool already provides instructions to the user
- After calling suggest mode: STOP immediately - let the user interact with the widget
- After calling apply mode: Use suggestedResponse to offer next steps

IMPORTANT:
- Use 'set' mode for automated flows where you should decide and apply immediately
- Use 'suggest' mode first when the user wants options
- Use 'apply' mode when user selects or specifies colors
- On apps with an attached design kit, 'set' is skipped (the kit is the default palette). To honor an explicit customer request to change colors, use 'apply' (or 'suggest' then 'apply')
- The widget has built-in "Apply" buttons and instructions - no additional text needed
- After apply mode, use suggestedResponse to offer next steps`,
  z.object({
    mode: z.enum(['suggest', 'apply', 'set']).describe('suggest: Generate palette options | apply: Apply a palette to CSS | set: Generate one palette and apply directly (non-interactive)'),
    description: z.string().optional().describe('For suggest/set mode: What kind of colors? (e.g., "warm purple tones for bakery", "professional blue", "dark cyberpunk"). Required for suggest and set modes. Ignored for apply mode.'),
    count: z.number().min(2).max(6).default(4).describe('For suggest mode: Number of palette options to generate (2-6, default 4)'),
    theme: z.enum(['light', 'dark', 'both']).default('both').describe('For suggest mode: Generate light, dark, or both types of palettes'),
    paletteName: z.string().optional().describe('For apply mode: Name of a previously suggested palette to apply'),
    primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Primary brand color (hex format, e.g., #9333EA)'),
    background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Background color (hex format, e.g., #FFFFFF for light, #0A0A0A for dark)'),
    secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Secondary color override (hex format)'),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Accent color override (hex format)'),
    muted: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Muted background color (hex format, e.g., #E8E8E8 for subtle backgrounds)'),
    mutedForeground: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Muted foreground/text color (hex format)'),
    border: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Border color (hex format)'),
    card: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Card background color (hex format, can be dark on light theme)'),
    cardForeground: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('For apply mode: Card foreground/text color (hex format)')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    const sessionId = context?.metadata?.sessionId as string | undefined
    const stateManager = context?.metadata?.stateManager as any
    const subscriptionId = context?.metadata?.subscriptionId as string | undefined
    const customerId = context?.metadata?.customerId as string | undefined

    // When the kit's tokens were applied in code by the forced-install path
    // (apply-kit-design.ts), its palette is the DEFAULT source of truth — block the
    // model from silently re-theming via 'set' (automated decide+apply). But an
    // explicit customer request ('apply' — the user selected or specified colors) is
    // honored even on a locked kit. 'suggest' only previews (no write), so it's also
    // exempt. The design-kit wizard never sets this marker, so it stays usable.
    if (input.mode === 'set' && appId && kitTokensLocked(appId)) {
      logger.info('colorScheme.kit.locked', { appId, mode: input.mode })
      return {
        success: true,
        skipped: true,
        message: COLOR_SCHEME_KIT_LOCKED_MESSAGE,
      }
    }

    if (input.mode === 'suggest') {
      if (!input.description) {
        throw new Error('Description is required for suggest mode')
      }

      logger.info('colorScheme.suggest.begin', {
        description: input.description,
        count: input.count,
        theme: input.theme
      })

      const agentId = context?.metadata?.agentId as string | undefined
      const customTags = context?.metadata?.tags as string[] | undefined
      const socketId = (context as any)?.socketId as string | undefined
      const budgetContext = extractBudgetContext(context)
      const llmPalettes = await generatePalettesWithLLM(
        input.description,
        input.count,
        input.theme,
        appId,
        sessionId,
        agentId,
        customTags,
        socketId,
        subscriptionId,
        customerId,
        budgetContext
      )

      const generatedPalettes = llmPalettes.map((paletteInput) => {
        const palette = generatePalette(paletteInput as ColorPalette)
        return formatPaletteForWidget(palette, paletteInput.name)
      })

      if (sessionId && stateManager?.storeSuggestedPalettes) {
        const palettesToStore = generatedPalettes.map(paletteData => ({
          name: paletteData.name,
          ...paletteData.palette
        }))
        stateManager.storeSuggestedPalettes(sessionId, palettesToStore)
      }

      logger.info('colorScheme.suggest.complete', {
        paletteCount: generatedPalettes.length
      })

      const widget: ColorPaletteGridWidget = {
        widgetType: 'color-palette-grid',
        widgetData: {
          palettes: generatedPalettes
        }
      }

      return {
        success: true,
        message: `Generated ${generatedPalettes.length} color palette suggestions`,
        widget,
        palettes: generatedPalettes
      }
    }

    if (input.mode === 'apply') {
      if (!appId) {
        throw new Error('App ID is required for apply mode')
      }

      const app = appRepo.findById(appId)
      if (!app) {
        throw new Error(`App '${appId}' not found`)
      }

      let paletteInput: ColorPalette
      let paletteName = input.paletteName || 'Custom Palette'

      if (input.paletteName && sessionId && stateManager?.getSuggestedPalette) {
        const suggestedPalette = stateManager.getSuggestedPalette(sessionId, input.paletteName)
        if (suggestedPalette) {
          logger.info('colorScheme.apply.palette_restored', {
            sessionId,
            paletteName: input.paletteName,
            primary: suggestedPalette.primary
          })
          paletteInput = suggestedPalette as ColorPalette
          paletteName = input.paletteName
        } else if (input.primary) {
          paletteInput = {
            primary: input.primary,
            background: input.background,
            secondary: input.secondary,
            accent: input.accent,
            muted: input.muted,
            mutedForeground: input.mutedForeground,
            border: input.border,
            card: input.card,
            cardForeground: input.cardForeground
          } as ColorPalette
        } else {
          throw new Error(`Palette '${input.paletteName}' not found in session. Please use suggest mode first or provide explicit colors.`)
        }
      } else if (input.primary) {
        paletteInput = {
          primary: input.primary,
          background: input.background,
          secondary: input.secondary,
          accent: input.accent,
          muted: input.muted,
          mutedForeground: input.mutedForeground,
          border: input.border,
          card: input.card,
          cardForeground: input.cardForeground
        } as ColorPalette
      } else {
        throw new Error('Either paletteName (from previous suggestion) or primary color is required for apply mode')
      }

      logger.info('colorScheme.apply.begin', {
        appId,
        paletteName,
        primary: paletteInput.primary,
        hasSemanticOverrides: !!(input.muted || input.card || input.border)
      })

      const workspace = createForWorkspace(appId, 'preview')
      if (!workspace) {
        throw new Error(`Workspace not available for app '${appId}'`)
      }

      const result = await updateCssColorPalette(workspace.files, paletteInput)

      if (!result.success) {
        throw new Error(result.message)
      }

      try {
        await appPlanTool.execute({
          appId,
          operation: 'update',
          colorPalette: {
            name: paletteName,
            ...result.palette
          }
        })
        logger.info('colorScheme.apply.saved', {
          appId,
          paletteName,
          primary: result.palette.primary
        })
      } catch (error) {
        logger.warn('colorScheme.apply.appPlan_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      // Persist to memory table for brand-data API
      try {
        await memoryStore.set(workspaceScopeFromAppId(appId, customerIdFromContext(context)), 'brand.colors.palette', {
          name: paletteName,
          ...result.palette
        })
      } catch (error) {
        logger.warn('colorScheme.apply.memory_write_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      logger.info('colorScheme.apply.complete', {
        appId,
        paletteName
      })

      const response = `Color scheme "${paletteName}" applied successfully!\n\n` +
        `Main Colors:\n` +
        `- Background: ${result.palette.background}\n` +
        `- Foreground: ${result.palette.foreground}\n` +
        `- Primary: ${result.palette.primary}\n` +
        `- Secondary: ${result.palette.secondary}\n` +
        `- Accent: ${result.palette.accent}\n\n` +
        `All CSS variables have been updated with the new color scheme.`

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
          card: result.palette.card,
          cardForeground: result.palette.cardForeground,
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
        theme: result.palette.theme,
        widget: {
          widgetType: 'color-palette',
          widgetData: {
            name: paletteName,
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
              card: result.palette.card,
              cardForeground: result.palette.cardForeground,
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
            }
          }
        } satisfies ColorPaletteWidget
      }
    }

    if (input.mode === 'set') {
      if (!input.description) {
        throw new Error('Description is required for set mode')
      }
      if (!appId) {
        throw new Error('App ID is required for set mode')
      }

      const app = appRepo.findById(appId)
      if (!app) {
        throw new Error(`App '${appId}' not found`)
      }

      logger.info('colorScheme.set.begin', {
        appId,
        description: input.description,
        theme: input.theme
      })

      const agentId = context?.metadata?.agentId as string | undefined
      const customTags = context?.metadata?.tags as string[] | undefined
      const socketId = (context as any)?.socketId as string | undefined
      const budgetContext = extractBudgetContext(context)
      const llmPalettes = await generatePalettesWithLLM(
        input.description,
        1,
        input.theme,
        appId,
        sessionId,
        agentId,
        customTags,
        socketId,
        subscriptionId,
        customerId,
        budgetContext
      )

      if (!llmPalettes.length) {
        throw new Error('Failed to generate color palette')
      }

      const llmPalette = llmPalettes[0]!
      const paletteName = llmPalette.name || 'Brand Palette'
      const paletteInput = llmPalette as unknown as ColorPalette

      const fullPalette = generatePalette(paletteInput)

      const workspace = createForWorkspace(appId, 'preview')
      if (!workspace) {
        throw new Error(`Workspace not available for app '${appId}'`)
      }

      const result = await updateCssColorPalette(workspace.files, paletteInput)

      if (!result.success) {
        throw new Error(result.message)
      }

      // Persist to AppPlanTool
      try {
        await appPlanTool.execute({
          appId,
          operation: 'update',
          colorPalette: {
            name: paletteName,
            ...result.palette
          }
        })
      } catch (error) {
        logger.warn('colorScheme.set.appPlan_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      // Persist to memory table for brand-data API
      try {
        await memoryStore.set(workspaceScopeFromAppId(appId, customerIdFromContext(context)), 'brand.colors.palette', {
          name: paletteName,
          ...result.palette
        })
      } catch (error) {
        logger.warn('colorScheme.set.memory_write_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      logger.info('colorScheme.set.complete', {
        appId,
        paletteName,
        primary: result.palette.primary
      })

      const widget: ColorPaletteWidget = {
        widgetType: 'color-palette',
        widgetData: {
          name: paletteName,
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
            card: result.palette.card,
            cardForeground: result.palette.cardForeground,
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
          }
        }
      }

      return {
        success: true,
        message: `Color scheme "${paletteName}" set successfully.`,
        paletteName,
        palette: result.palette,
        theme: result.palette.theme,
        widget
      }
    }

    throw new Error(`Invalid mode: ${input.mode}`)
  }
)

