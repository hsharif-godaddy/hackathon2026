import { createTool, generateTextWithTracking, calculateCostEstimate, llmMetadataContext, type LitellmMetadata, type Tool, createPromptBuilder } from '@airo/ai-lib'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { TokenUsageRepository } from '../../database/repositories/TokenUsageRepository.js'
import { getAgentModelWithName } from '../../utils/model-selection.js'
import { logger } from '../../logging/index.js'

const appRepo = new AppRepository()
const tokenUsageRepo = new TokenUsageRepository()

type FontCategory = 'serif' | 'sans-serif' | 'monospace' | 'cursive' | 'fantasy'

/**
 * Get CSS fallback fonts for a given category
 */
function getFallback(category: FontCategory): string {
  switch (category) {
    case 'serif':
      return 'Georgia, serif'
    case 'sans-serif':
      return '-apple-system, BlinkMacSystemFont, sans-serif'
    case 'monospace':
      return 'ui-monospace, "Courier New", monospace'
    case 'cursive':
      return 'cursive'
    case 'fantasy':
      return 'fantasy'
    default:
      return '-apple-system, BlinkMacSystemFont, sans-serif'
  }
}

/**
 * Build Google Fonts URL for a font and weights
 */
function buildGoogleFontsUrl(fontName: string, weights: string[]): string {
  return `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@${weights.join(';')}&display=swap`
}

/**
 * Fallback function to detect font category when LLM doesn't provide it
 */
function detectFontCategory(fontName: string): FontCategory {
  const fontLower = fontName.toLowerCase()
  
  const serifFonts = [
    'playfair', 'merriweather', 'lora', 'crimson', 'cormorant',
    'baskerville', 'spectral', 'bodoni', 'garamond', 'times',
    'georgia', 'cardo', 'neuton', 'vollkorn', 'bitter', 'arvo'
  ]
  
  const monospaceFonts = [
    'mono', 'code', 'courier', 'consolas', 'menlo', 'monaco',
    'source code', 'roboto mono', 'fira code', 'jetbrains', 'inconsolata'
  ]
  
  const cursiveFonts = [
    'script', 'cursive', 'pacifico', 'dancing', 'satisfy', 'kaushan',
    'allura', 'great vibes', 'sacramento', 'tangerine'
  ]
  
  const fantasyFonts = [
    'impact', 'papyrus', 'brush', 'abril fatface', 'alfa slab',
    'bangers', 'bebas', 'fredoka', 'lobster', 'permanent marker',
    'righteous', 'rubik mono', 'special elite'
  ]
  
  if (monospaceFonts.some(mono => fontLower.includes(mono))) return 'monospace'
  if (cursiveFonts.some(cursive => fontLower.includes(cursive))) return 'cursive'
  if (fantasyFonts.some(fantasy => fontLower.includes(fantasy))) return 'fantasy'
  if (serifFonts.some(serif => fontLower.includes(serif))) return 'serif'
  
  return 'sans-serif'
}

/**
 * Load font generation prompt from markdown file
 */
async function loadFontGenerationPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()
  
  // Get the path to the prompts directory (go up from tools/ai-lib-tools to src/prompts)
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const promptPath = path.resolve(currentDir, '../../prompts/font-tool/font-generation.md')
  
  promptBuilder.file(promptPath)
  
  return await promptBuilder.build()
}

async function generateFontsWithLLM(
  description: string,
  count: number,
  appId?: string,
  sessionId?: string
): Promise<Array<{
  id: string
  name: string
  description: string
  fontName: string
  weights: string[]
  category?: FontCategory
}>> {
  const { model, modelName } = await getAgentModelWithName('fast')
  const systemPrompt = await loadFontGenerationPrompt()

  const userPrompt = `Generate ${count} Google Font recommendation${count > 1 ? 's' : ''} for: ${description}

Return ONLY the JSON object with the fonts array. No markdown, no code blocks, no explanatory text.`

  const contextData: {
    appId?: string
    conversationId?: string
    description: string
    toolName: string
  } = {
    description: 'Font theme generation',
    toolName: 'fontTheme'
  }

  if (appId) contextData.appId = appId
  if (sessionId) contextData.conversationId = sessionId

  // Check if metadata already exists in parent context
  const existingMetadata = llmMetadataContext.getStore()

  // Only look up app if user doesn't exist in parent context
  let userIdentifier = existingMetadata?.user
  if (!userIdentifier && appId) {
    const app = appRepo.findById(appId)
    userIdentifier = app?.subscriptionId || app?.customerId
  }

  // Merge existing tags with source tag
  const mergedTags = [...new Set([...(existingMetadata?.tags || []), 'source:tool-llm', 'source:font-theme'])]

  const metadata: LitellmMetadata = {
    ...(userIdentifier && { user: userIdentifier }),
    tags: mergedTags
  }

  const generateFontsFn = async () => generateTextWithTracking({
    model,
    modelName,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.7,
    context: contextData,
    onUsage: async function trackUsage(usage) {
      if (!appId) return

      const costEstimate = calculateCostEstimate(
        {
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          ...(usage.cachedTokens && { cachedInputTokensRead: usage.cachedTokens })
        },
        modelName
      )

      await tokenUsageRepo.recordUsage(
        appId,
        'llm_request',
        usage.promptTokens,
        usage.completionTokens,
        {
          model: modelName,
          conversationId: sessionId,
          description: 'Font theme generation (tool-initiated LLM call)',
          cost: costEstimate.totalCost,
          cacheReadTokens: usage.cachedTokens
        }
      )
    }
  })

  const result = await llmMetadataContext.run(metadata, generateFontsFn)

  let cleanedText = result.text.trim()

  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  try {
    const parsed = JSON.parse(cleanedText)

    if (!parsed.fonts || !Array.isArray(parsed.fonts)) {
      throw new Error('Invalid response format: missing fonts array')
    }

    const validFonts = parsed.fonts.filter((font: any) =>
      font.id &&
      font.name &&
      font.fontName &&
      font.weights &&
      Array.isArray(font.weights)
    )

    if (validFonts.length === 0) {
      throw new Error('No valid fonts in LLM response')
    }

    logger.info('fontTheme.llm.success', {
      requestedCount: count,
      receivedCount: validFonts.length,
      fonts: validFonts.map((f: any) => f.fontName)
    })

    return validFonts
  } catch (error) {
    logger.error('fontTheme.llm.parse_error', {
      error: error instanceof Error ? error.message : String(error),
      response: cleanedText.substring(0, 500)
    })
    throw new Error(`Failed to parse LLM font recommendations: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface FontThemeGridWidget {
  widgetType: 'font-theme-grid'
  widgetData: {
    themes: Array<{
      id: string
      name: string
      description: string
      font: {
        name: string
        weights: string[]
        category: FontCategory
      }
    }>
  }
}

/**
 * Professional font theme presets for websites
 */
export const FONT_THEMES: Record<string, {
  name: string
  description: string
  font: {
    name: string
    weights: string[]
    category: FontCategory
    fallback: string
    googleFontsUrl: string
  }
}> = {
  'modern-professional': {
    name: 'Modern Professional',
    description: 'Clean, highly readable sans-serif. Perfect for tech, SaaS, and corporate sites.',
    font: {
      name: 'Inter',
      weights: ['400', '600', '700'],
      category: 'sans-serif',
      fallback: '-apple-system, BlinkMacSystemFont, sans-serif',
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
    }
  },
  'elegant-serif': {
    name: 'Elegant Serif',
    description: 'Sophisticated serif font. Ideal for publishing, blogs, and content-heavy sites.',
    font: {
      name: 'Lora',
      weights: ['400', '600', '700'],
      category: 'serif',
      fallback: 'Georgia, serif',
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&display=swap'
    }
  },
  'bold-modern': {
    name: 'Bold Modern',
    description: 'Strong geometric sans-serif. Perfect for creative agencies, portfolios, and design-focused sites.',
    font: {
      name: 'Montserrat',
      weights: ['400', '600', '700'],
      category: 'sans-serif',
      fallback: '-apple-system, BlinkMacSystemFont, sans-serif',
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap'
    }
  },
  'classic-formal': {
    name: 'Classic Formal',
    description: 'Traditional serif font. Excellent for law firms, financial services, luxury brands.',
    font: {
      name: 'Merriweather',
      weights: ['400', '600', '700'],
      category: 'serif',
      fallback: 'Georgia, serif',
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;600;700&display=swap'
    }
  }
}

export async function updateCssFontVariables(appPath: string, theme: typeof FONT_THEMES[keyof typeof FONT_THEMES]): Promise<{ success: boolean; message: string }> {
  const cssPath = `${appPath}/src/styles/globals.css`

  try {
    let cssContent = await readFile(cssPath, 'utf8')

    // Remove ALL existing Google Fonts imports to avoid stacking
    cssContent = cssContent.replace(/@import url\('https:\/\/fonts\.googleapis\.com\/css2\?[^']+'\);\s*/g, '')

    // Add the new Google Fonts import at the top (before @tailwind directives)
    const googleFontsImport = `@import url('${theme.font.googleFontsUrl}');\n\n`
    cssContent = googleFontsImport + cssContent

    // Update or add --font-sans variable
    const fontSansRegex = /--font-sans:\s*[^;]+;/
    const newFontSans = `--font-sans: "${theme.font.name}", ${theme.font.fallback};`
    
    if (fontSansRegex.test(cssContent)) {
      cssContent = cssContent.replace(fontSansRegex, newFontSans)
    } else {
      // Add --font-sans to :root in @layer base (for old apps that don't have it)
      const rootBlockRegex = /(:root\s*\{)/
      if (rootBlockRegex.test(cssContent)) {
        // Find the first CSS variable or closing brace to insert after
        const insertAfterRootRegex = /(:root\s*\{)(\s*(?:\/\*.*?\*\/)?\s*(?:--[^;]+;)?)/
        cssContent = cssContent.replace(insertAfterRootRegex, `$1$2\n    ${newFontSans}`)
      } else {
        // No :root block exists, create one in @layer base
        const baseLayerRegex = /(@layer base\s*\{)/
        if (baseLayerRegex.test(cssContent)) {
          cssContent = cssContent.replace(baseLayerRegex, `$1\n  :root {\n    ${newFontSans}\n  }\n`)
        } else {
          throw new Error('Could not find suitable location to add font variables')
        }
      }
    }

    // Update or add --font-heading variable
    const fontHeadingRegex = /--font-heading:\s*[^;]+;/
    const newFontHeading = `--font-heading: "${theme.font.name}", ${theme.font.fallback};`
    
    if (fontHeadingRegex.test(cssContent)) {
      cssContent = cssContent.replace(fontHeadingRegex, newFontHeading)
    } else {
      // Add --font-heading after --font-sans
      const fontSansLocationRegex = /(--font-sans:\s*[^;]+;)/
      if (fontSansLocationRegex.test(cssContent)) {
        cssContent = cssContent.replace(fontSansLocationRegex, `$1\n    ${newFontHeading}`)
      } else {
        // Fallback: add to :root
        const rootBlockRegex = /(:root\s*\{)/
        if (rootBlockRegex.test(cssContent)) {
          const insertAfterRootRegex = /(:root\s*\{)(\s*(?:\/\*.*?\*\/)?\s*(?:--[^;]+;)?)/
          cssContent = cssContent.replace(insertAfterRootRegex, `$1$2\n    ${newFontHeading}`)
        }
      }
    }

    // Ensure body uses --font-sans variable directly (robust for all apps)
    const bodyRuleRegex = /body \{([^}]*)\}/
    const bodyMatch = cssContent.match(bodyRuleRegex)
    
    if (bodyMatch && bodyMatch[1] !== undefined) {
      const bodyContent = bodyMatch[1]
      
      // Check if body already has font-family rule
      if (/font-family:/.test(bodyContent)) {
        // Replace existing font-family with variable
        cssContent = cssContent.replace(
          /body \{([^}]*?)font-family:[^;]+;([^}]*)\}/,
          'body {$1font-family: var(--font-sans);$2}'
        )
      } else {
        // Add font-family to existing body rule
        cssContent = cssContent.replace(
          bodyRuleRegex,
          `body {$1\n    font-family: var(--font-sans);
  }`
        )
      }
    } else {
      // If no body rule exists at all, create one with font-family
      const bodyRule = `\n  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans);
  }`
      const baseLayerRegex = /(@layer base \{[\s\S]*?:root \{[\s\S]*?\})/
      if (baseLayerRegex.test(cssContent)) {
        cssContent = cssContent.replace(baseLayerRegex, `$1${bodyRule}`)
      }
    }

    // Ensure heading elements use --font-heading with !important (to override Tailwind utility classes)
    const headingRule = `h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading) !important;
  }`
    
    // Check if heading rule already exists
    const existingHeadingRuleRegex = /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-family[^}]*\}/
    
    if (existingHeadingRuleRegex.test(cssContent)) {
      // Update existing heading rule to use variable
      cssContent = cssContent.replace(
        /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-family:[^;]+;[^}]*\}/,
        headingRule
      )
    } else {
      // Add heading rule after body in @layer base
      const bodyRuleRegex = /(body \{[^}]*\})/
      if (bodyRuleRegex.test(cssContent)) {
        cssContent = cssContent.replace(bodyRuleRegex, `$1\n\n  ${headingRule}`)
      } else if (cssContent.includes('@layer base')) {
        // Fallback: add after @layer base opening
        const baseLayerRegex = /(@layer base\s*\{)/
        cssContent = cssContent.replace(baseLayerRegex, `$1\n\n  ${headingRule}\n`)
      }
    }

    await writeFile(cssPath, cssContent, 'utf8')

    logger.info('fontTheme.apply.success', {
      themeName: theme.name,
      font: theme.font.name
    })

    return {
      success: true,
      message: `Font theme "${theme.name}" (${theme.font.name}) applied successfully.`
    }
  } catch (error) {
    logger.error('fontTheme.apply.error', {
      error: error instanceof Error ? error.message : String(error)
    })
    return {
      success: false,
      message: `Failed to update fonts: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export const fontThemeAITool: Tool = createTool(
  `Manage font themes for professional websites.

This tool has three modes:

**SET MODE** - Directly set a font (recommended for automated flows):
- Picks and applies a font immediately without showing options
- Use when you want to make a decision and apply it directly
- Provide a description of desired font style (e.g., "modern sans-serif for tech startup")
- The LLM will generate ONE appropriate font and apply it automatically
- Perfect for rebuild flows where you want to pick fonts programmatically

**SUGGEST MODE** - Show font theme options (for interactive flows):
- With description: Generates custom LLM-powered font recommendations (2-6 options)
- Without description: Shows 4 curated professional font themes
- Displays visual preview of each font with actual rendering
- User can click "Apply" on any theme

**APPLY MODE** - Apply a previously suggested font theme:
- Updates CSS variables with selected fonts
- Loads Google Fonts automatically
- Provides implementation guidance

CURATED THEMES (shown when no description provided in suggest mode):
1. Modern Professional - Inter (tech, SaaS, corporate)
2. Elegant Serif - Lora (publishing, blogs, editorial)
3. Bold Modern - Montserrat (creative agencies, portfolios)
4. Classic Formal - Merriweather (law firms, luxury brands)

WORKFLOW FOR SET MODE (automated/rebuild flows):
1. Agent: fontTheme({ mode: 'set', description: 'elegant serif for luxury brand' })
2. Tool generates ONE font recommendation and applies it immediately
3. Tool confirms which font was applied
4. No user interaction needed

WORKFLOW FOR SUGGEST MODE (interactive flows):
1. User: "What are some best fonts for my app?"
2. You: fontTheme({ mode: 'suggest' })
3. Tool displays widget with 4 curated theme previews
4. User clicks "Apply" on a theme (message: "Apply font theme: Modern Professional")
5. You: fontTheme({ mode: 'apply', themeName: 'Modern Professional' })
6. Tool updates CSS and confirms

🚨 CRITICAL: PARSING APPLY MESSAGES 🚨
When you receive a message like "Apply font theme: <NAME>":
1. Extract everything after "Apply font theme: " as the themeName
2. Look back in conversation history for the fontTheme result with that font
3. Extract fontName and weights from that result
4. Call with BOTH: fontTheme({ mode: 'apply', themeName: '<NAME>', fontName: '...', weights: [...] })

Examples:
- Message: "Apply font theme: Dynamic Edge"
- Find in history: { name: "Dynamic Edge", fontName: "Montserrat", weights: ["400", "700"] }
- Call: fontTheme({ mode: 'apply', themeName: 'Dynamic Edge', fontName: 'Montserrat', weights: ['400', '700'] })

WHY provide both themeName AND fontName/weights?
- themeName retrieves from session (fast, preferred)
- fontName/weights is FALLBACK if session is lost (refresh, timeout, restart)
- This makes the tool robust - works even if session state is unavailable

CRITICAL RULES FOR INTERACTIVE FLOWS:
- For user questions: Use suggest mode first - NEVER go directly to apply mode
- Use apply mode ONLY when user clicks "Apply" button in the widget (system event)
- Chat messages like "apply a new font", "use a different font" should trigger suggest mode
- After suggest mode: DO NOT list or describe the themes - the widget shows them visually
- After suggest mode: STOP immediately - let user interact with widget

CRITICAL RULES FOR AUTOMATED FLOWS (rebuild, initial setup):
- Use SET mode to pick and apply fonts directly without user interaction
- Provide a description of the desired font style based on site purpose/brand
- The tool will generate ONE font and apply it automatically

MODE SELECTION GUIDE:
- SET mode: Automated flows, rebuild, when you want to decide and apply immediately
- SUGGEST mode: User asks for options, wants to explore different fonts
- APPLY mode: User clicks "Apply" button in widget after seeing suggestions`,
  z.object({
    mode: z.enum(['set', 'suggest', 'apply']).describe('set: Pick and apply font directly | suggest: Show font options | apply: Apply a selected theme'),
    description: z.string().optional().describe('For set/suggest mode: What kind of fonts? (e.g., "elegant serif for luxury brand", "modern tech fonts"). Required for set mode. For suggest mode, if omitted, shows 4 curated professional themes.'),
    count: z.number().min(2).max(6).default(4).describe('For suggest mode with description: Number of font recommendations to generate (2-6, default 4)'),
    themeId: z.string().optional().describe('For apply mode: ID of theme to apply (e.g., "modern-professional") or custom font ID from LLM suggestions'),
    themeName: z.string().optional().describe('For apply mode: EXTRACT theme name from messages like "Apply font theme: Dynamic Edge" → use "Dynamic Edge". This retrieves the font from session state. REQUIRED when message starts with "Apply font theme:"'),
    fontName: z.string().optional().describe('For apply mode with custom fonts: Google Font name (e.g., "Crimson Text")'),
    weights: z.array(z.string()).optional().describe('For apply mode with custom fonts: Font weights to load (e.g., ["400", "600"])')
  }),
  async (input, context) => {
    try {
      const appId = context?.metadata?.appId as string
      const sessionId = context?.metadata?.sessionId as string | undefined
      const stateManager = context?.metadata?.stateManager as any

      if (input.mode === 'set') {
        if (!appId) {
          throw new Error('App ID is required for set mode')
        }

        if (!input.description) {
          throw new Error('Description is required for set mode')
        }

        logger.info('fontTheme.set.begin', {
          appId,
          description: input.description
        })

        // Generate ONE font recommendation
        const llmFonts = await generateFontsWithLLM(
          input.description,
          1,
          appId,
          sessionId
        )

        if (llmFonts.length === 0) {
          throw new Error('Failed to generate font recommendation')
        }

        const selectedFont = llmFonts[0]!

        // Apply the font immediately
        const category = selectedFont.category || detectFontCategory(selectedFont.fontName)
        const theme = {
          name: selectedFont.name,
          description: selectedFont.description,
          font: {
            name: selectedFont.fontName,
            weights: selectedFont.weights,
            category,
            fallback: getFallback(category),
            googleFontsUrl: buildGoogleFontsUrl(selectedFont.fontName, selectedFont.weights)
          }
        }

        const app = await appRepo.findById(appId)
        if (!app) {
          throw new Error(`App not found: ${appId}`)
        }

        const result = await updateCssFontVariables(app.path, theme)

        if (!result.success) {
          throw new Error(result.message)
        }

        logger.info('fontTheme.set.complete', {
          appId,
          fontName: selectedFont.fontName,
          themeName: selectedFont.name
        })

        return {
          success: true,
          message: `Applied font theme: ${selectedFont.name}`,
          appliedFont: {
            name: selectedFont.name,
            fontName: selectedFont.fontName,
            weights: selectedFont.weights,
            category
          },
          suggestedResponse: `Font theme "${selectedFont.name}" (${selectedFont.fontName}) has been applied.`
        }
      }

      if (input.mode === 'suggest') {
      if (input.description) {
        logger.info('fontTheme.suggest.llm.begin', {
          description: input.description,
          count: input.count
        })

        const llmFonts = await generateFontsWithLLM(
          input.description,
          input.count,
          appId,
          sessionId
        )

        const themes = llmFonts.map(font => ({
          id: font.id,
          name: font.name,
          description: font.description,
          font: {
            name: font.fontName,
            weights: font.weights,
            category: font.category || detectFontCategory(font.fontName)
          }
        }))

        if (sessionId && stateManager?.storeSuggestedFonts) {
          const fontsToStore = themes.map(theme => ({
            name: theme.name,
            fontName: theme.font.name,
            weights: theme.font.weights,
            category: theme.font.category
          }))
          stateManager.storeSuggestedFonts(sessionId, fontsToStore)
        }

        logger.info('fontTheme.suggest.llm.complete', {
          themeCount: themes.length
        })

        const widget: FontThemeGridWidget = {
          widgetType: 'font-theme-grid',
          widgetData: {
            themes
          }
        }

        return {
          success: true,
          message: `Generated ${themes.length} custom font recommendations`,
          widget,
          themes
        }
      }

      logger.info('fontTheme.suggest.curated.begin')

      const themes = Object.entries(FONT_THEMES).map(([key, theme]) => ({
        id: key,
        name: theme.name,
        description: theme.description,
        font: {
          name: theme.font.name,
          weights: theme.font.weights,
          category: theme.font.category
        }
      }))

      const widget: FontThemeGridWidget = {
        widgetType: 'font-theme-grid',
        widgetData: {
          themes
        }
      }

      return {
        success: true,
        message: `Showing ${themes.length} professional font theme options`,
        widget,
        themes
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

      let themeToApply: typeof FONT_THEMES[keyof typeof FONT_THEMES]
      let themeName: string

      let extractedThemeName = input.themeName
      if (!extractedThemeName && context?.messages) {
        const lastUserMessage = [...context.messages].reverse().find(msg => msg.role === 'user')
        if (lastUserMessage?.content) {
          let content = ''
          if (typeof lastUserMessage.content === 'string') {
            content = lastUserMessage.content
          } else if (Array.isArray(lastUserMessage.content)) {
            const textPart = lastUserMessage.content.find(part => 'text' in part)
            content = textPart && 'text' in textPart ? textPart.text : ''
          }
          const match = content.match(/Apply font theme:\s*(.+?)$/i)
          if (match && match[1]) {
            extractedThemeName = match[1].trim()
            logger.info('fontTheme.apply.extracted_from_message', {
              originalMessage: content,
              extractedThemeName
            })
          } else {
            logger.warn('fontTheme.apply.extraction_failed', {
              originalMessage: content,
              hadMatch: !!match
            })
          }
        }
      }

      logger.info('fontTheme.apply.debug', {
        hasThemeId: !!input.themeId,
        hasExtractedName: !!extractedThemeName,
        extractedThemeName,
        hasSessionId: !!sessionId,
        sessionId,
        hasStateManager: !!stateManager,
        hasGetSuggestedFont: !!stateManager?.getSuggestedFont,
        hasFontName: !!input.fontName,
        inputThemeName: input.themeName,
        contextHasMessages: !!context?.messages,
        messageCount: context?.messages?.length
      })

      if (input.themeId && FONT_THEMES[input.themeId]) {
        const curatedTheme = FONT_THEMES[input.themeId]!
        themeToApply = curatedTheme
        themeName = curatedTheme.name

        logger.info('fontTheme.apply.curated', {
          appId,
          themeId: input.themeId
        })
      } else if (extractedThemeName && sessionId && stateManager?.getSuggestedFont) {
        const suggestedFont = stateManager.getSuggestedFont(sessionId, extractedThemeName)
        if (suggestedFont) {
          logger.info('fontTheme.apply.session_restored', {
            sessionId,
            themeName: extractedThemeName,
            fontName: suggestedFont.fontName
          })

          const googleFontsUrl = `https://fonts.googleapis.com/css2?family=${suggestedFont.fontName.replace(/\s+/g, '+')}:wght@${suggestedFont.weights.join(';')}&display=swap`

          themeToApply = {
            name: extractedThemeName,
            description: `Custom font: ${suggestedFont.fontName}`,
            font: {
              name: suggestedFont.fontName,
              weights: suggestedFont.weights,
              category: suggestedFont.category,
              fallback: getFallback(suggestedFont.category),
              googleFontsUrl
            }
          }
          themeName = extractedThemeName
        } else if (input.fontName && input.weights) {
          logger.info('fontTheme.apply.fallback_to_explicit', {
            themeName: extractedThemeName,
            fontName: input.fontName,
            reason: 'Not found in session, using explicit fontName/weights from agent'
          })

          const weights = input.weights
          const googleFontsUrl = `https://fonts.googleapis.com/css2?family=${input.fontName.replace(/\s+/g, '+')}:wght@${weights.join(';')}&display=swap`
          const category = detectFontCategory(input.fontName)

          themeToApply = {
            name: extractedThemeName,
            description: `Custom font: ${input.fontName}`,
            font: {
              name: input.fontName,
              weights,
              category,
              fallback: getFallback(category),
              googleFontsUrl
            }
          }
          themeName = extractedThemeName
        } else {
          throw new Error(`Font theme '${extractedThemeName}' not found in session. Please use suggest mode first or provide fontName and weights.`)
        }
      } else if (input.fontName && input.weights) {
        const weights = input.weights
        const googleFontsUrl = `https://fonts.googleapis.com/css2?family=${input.fontName.replace(/\s+/g, '+')}:wght@${weights.join(';')}&display=swap`

        const category = detectFontCategory(input.fontName)
        
        themeToApply = {
          name: input.fontName,
          description: `Custom font: ${input.fontName}`,
          font: {
            name: input.fontName,
            weights,
            category,
            fallback: getFallback(category),
            googleFontsUrl
          }
        }
        themeName = input.fontName

        logger.info('fontTheme.apply.custom', {
          appId,
          fontName: input.fontName,
          weights
        })
      } else {
        throw new Error(`Either themeId (for curated themes), themeName (from previous suggestion), or fontName + weights are required for apply mode.`)
      }

      const result = await updateCssFontVariables(app.path, themeToApply)

      if (!result.success) {
        throw new Error(result.message)
      }

      return {
        success: true,
        message: `Applied "${themeName}" font theme successfully.`,
        themeId: input.themeId,
        themeName,
        fontName: themeToApply.font.name
      }
    }

    throw new Error(`Invalid mode: ${input.mode}`)
    } catch (error) {
      logger.error('fontTheme.error', {
        mode: input.mode,
        error: error instanceof Error ? error.message : String(error)
      })
      
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  }
)

