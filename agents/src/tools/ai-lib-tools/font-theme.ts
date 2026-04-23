import { createTool, generateTextWithTracking, type Tool, createPromptBuilder, type AgentContext } from '@airo/ai-lib'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-grants'
import { extractBudgetContext, withBudgetFields, type ToolBudgetContext } from './tool-budget-context.js'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { MemoryRepository } from '../../database/repositories/MemoryRepository.js'

import { appPlanTool } from '../app-plan-tool.js'
import { getAgentModelWithName } from '../../utils/model-selection.js'
import { logger } from '../../logging/index.js'

const appRepo = new AppRepository()
const memoryRepo = new MemoryRepository()

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
 * Build Google Fonts URL for one or more fonts with their weights.
 * Deduplicates fonts by name and merges weights.
 */
export function buildGoogleFontsUrl(fonts: Array<{ name: string; weights: string[] }>): string {
  // Deduplicate and merge weights by font name
  const fontMap = new Map<string, Set<string>>()

  for (const font of fonts) {
    const existing = fontMap.get(font.name)
    if (existing) {
      // Merge weights
      font.weights.forEach(w => existing.add(w))
    } else {
      fontMap.set(font.name, new Set(font.weights))
    }
  }

  // Build URL with all fonts
  const familyParams = Array.from(fontMap.entries()).map(([name, weights]) => {
    const sortedWeights = Array.from(weights).sort()
    return `${name.replace(/\s+/g, '+')}:wght@${sortedWeights.join(';')}`
  })

  return `https://fonts.googleapis.com/css2?family=${familyParams.join('&family=')}&display=swap`
}

/**
 * Validate that a font URL is valid by making a HEAD request to Google Fonts.
 * This validates the exact URL we'll import, including weights.
 */
async function validateGoogleFontUrl(url: string, fontName: string): Promise<{ valid: boolean; networkError: boolean }> {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })

    if (response.ok) {
      // 2xx: URL is valid and reachable
      return { valid: true, networkError: false }
    }

    // Log non-2xx responses with status information for observability
    logger.warn('fontTheme.validation.non_2xx_status', {
      fontName,
      url,
      status: response.status,
      statusText: response.statusText
    })

    const status = response.status

    // 400/404: treat as definitively invalid font (no network error)
    if (status === 400 || status === 404) {
      return { valid: false, networkError: false }
    }

    // 429 and 5xx: likely transient (rate limiting / server error) -> network error
    if (status === 429 || (status >= 500 && status <= 599)) {
      return { valid: false, networkError: true }
    }

    // Any other unexpected non-2xx codes: conservatively treat as network error
    return { valid: false, networkError: true }
  } catch (error) {
    logger.error('fontTheme.validation.network_error', {
      fontName,
      url,
      error: error instanceof Error ? error.message : String(error)
    })
    return { valid: false, networkError: true }
  }
}

/**
 * Simple LRU cache to bound memory usage of font validation results.
 */
class LruCache<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value === undefined) {
      return undefined
    }
    // Refresh key as most recently used
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      // Remove so that insertion below moves it to the end (most recently used)
      this.map.delete(key)
    }
    this.map.set(key, value)

    if (this.map.size > this.maxSize) {
      // Evict least recently used entry (the first key in insertion order)
      const oldestKey = this.map.keys().next().value
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey)
      }
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/**
 * Cache for validated font URLs to avoid duplicate requests.
 * Bounded with an LRU policy to prevent unbounded memory growth.
 */
const fontValidationCache = new LruCache<string, boolean>(500)

/**
 * Clear the font validation cache (for testing)
 * @internal
 */
export function clearFontValidationCache(): void {
  fontValidationCache.clear()
}

/**
 * Validate and filter font pairings against Google Fonts API.
 * Uses cache to avoid redundant HTTP calls. Distinguishes network errors from validation failures.
 * @internal - exported for testing
 */
export async function validateAndFilterFonts(
  fonts: LLMFontPairing[],
  requestedCount?: number
): Promise<LLMFontPairing[]> {
  logger.info('fontTheme.llm.validating_fonts', {
    count: fonts.length,
    fonts: fonts.map((f) => ({
      header: f.headerFont.name,
      body: f.bodyFont.name
    }))
  })

  const verifiedFonts: LLMFontPairing[] = []
  let networkErrorCount = 0

  for (const font of fonts) {
    // Build the actual Google Fonts URL we'll use (validates exact import)
    const googleFontsUrl = buildGoogleFontsUrl([
      { name: font.headerFont.name, weights: font.headerFont.weights },
      { name: font.bodyFont.name, weights: font.bodyFont.weights }
    ])

    // Check cache first
    let isValid = fontValidationCache.get(googleFontsUrl)
    let hadNetworkError = false

    if (isValid === undefined) {
      // Not in cache, validate via API
      const result = await validateGoogleFontUrl(
        googleFontsUrl,
        `${font.headerFont.name} / ${font.bodyFont.name}`
      )
      isValid = result.valid
      hadNetworkError = result.networkError

      // Only cache successful validations (don't cache network errors)
      if (!hadNetworkError) {
        fontValidationCache.set(googleFontsUrl, isValid)
      }
    }

    if (isValid) {
      verifiedFonts.push(font)
    } else {
      if (hadNetworkError) {
        networkErrorCount++
      }

      logger.warn('fontTheme.llm.font_rejected', {
        theme: font.name,
        headerFont: font.headerFont.name,
        bodyFont: font.bodyFont.name,
        url: googleFontsUrl,
        reason: hadNetworkError ? 'network_error' : 'font_not_found'
      })
    }
  }

  if (verifiedFonts.length === 0) {
    const errorType = networkErrorCount === fonts.length ? 'network' : 'validation'
    let errorMessage: string

    if (errorType === 'network') {
      errorMessage = 'Could not validate fonts due to network errors. Please try again.'
    } else if (networkErrorCount > 0) {
      errorMessage =
        'All LLM-generated fonts failed validation. Some fonts could not be validated due to network errors (e.g., temporary Google Fonts issues or rate limiting), and the remaining fonts do not exist on Google Fonts or use unsupported weights. Please try again with a different description.'
    } else {
      errorMessage =
        'All LLM-generated fonts failed validation. The fonts do not exist on Google Fonts or use unsupported weights. Please try again with a different description.'
    }

    logger.error('fontTheme.llm.all_fonts_rejected', {
      totalFonts: fonts.length,
      networkErrors: networkErrorCount,
      errorType
    })

    throw new Error(errorMessage)
  }

  logger.info('fontTheme.llm.success', {
    requestedCount: requestedCount ?? fonts.length,
    receivedCount: verifiedFonts.length,
    rejectedCount: fonts.length - verifiedFonts.length,
    networkErrorCount,
    pairings: verifiedFonts.map((f) => ({
      header: f.headerFont.name,
      body: f.bodyFont.name
    }))
  })

  return verifiedFonts
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

interface LLMFontPairing {
  id: string
  name: string
  description: string
  headerFont: {
    name: string
    weights: string[]
    category: FontCategory
  }
  bodyFont: {
    name: string
    weights: string[]
    category: FontCategory
  }
}

export async function generateFontsWithLLM(
  description: string,
  count: number,
  appId?: string,
  sessionId?: string,
  agentId?: string,
  socketId?: string,
  customTags?: string[],
  subscriptionId?: string,
  customerId?: string,
  budgetContext?: ToolBudgetContext
): Promise<LLMFontPairing[]> {
  const { model, modelName } = await getAgentModelWithName('fast')
  const systemPrompt = await loadFontGenerationPrompt()

  const userPrompt = `Generate ${count} font pairing${count > 1 ? 's' : ''} for: ${description}

Return ONLY the JSON object with the fonts array containing headerFont and bodyFont for each pairing. No markdown, no code blocks, no explanatory text.`

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
  const additionalTags = ['source:tool-llm', 'source:font-theme']
  if (customTags?.length) additionalTags.push(...customTags)

  // Build metadata using the grants-aware helper
  let metadata: LitellmMetadata | null = null
  if (executionContext) {
    metadata = buildLitellmMetadataFromContext(executionContext, {
      source: LlmCallSource.ToolFontTheme,
      agentId,
    })
  }

  // Merge additional tags into metadata from grants-aware helper
  if (metadata) {
    const mergedTags = [...new Set([...(metadata.tags || []), ...additionalTags])]
    metadata = { ...metadata, tags: mergedTags }
  }

  // Fallback to existing context if buildLitellmMetadataFromContext returned null
  // (feature flag off or no socketId available)
  if (!metadata) {
    const existingMetadata = llmMetadataContext.getStore()
    let userIdentifier = existingMetadata?.user
    if (!userIdentifier && appId) {
      const app = appRepo.findById(appId)
      userIdentifier = app?.subscriptionId || app?.customerId
    }
    const baseTags = ['source:tool-llm', 'source:font-theme']
    if (agentId) baseTags.push(`agent:${agentId}`)
    if (customTags?.length) baseTags.push(...customTags)
    const mergedTags = [...new Set([...(existingMetadata?.tags || []), ...baseTags])]
    metadata = {
      ...(userIdentifier && { user: userIdentifier }),
      tags: mergedTags
    }
  }

  const generateFontsFn = async () => generateTextWithTracking({
    model,
    modelName,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.7,
    context: contextData
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

    // Validate and normalize font pairings
    const validFonts: LLMFontPairing[] = []

    for (const font of parsed.fonts) {
      if (!font.id || !font.name) continue

      // Check for new headerFont/bodyFont format
      if (font.headerFont?.name && font.bodyFont?.name) {
        validFonts.push({
          id: font.id,
          name: font.name,
          description: font.description || '',
          headerFont: {
            name: font.headerFont.name,
            weights: font.headerFont.weights || ['400', '700'],
            category: font.headerFont.category || detectFontCategory(font.headerFont.name)
          },
          bodyFont: {
            name: font.bodyFont.name,
            weights: font.bodyFont.weights || ['400', '500'],
            category: font.bodyFont.category || detectFontCategory(font.bodyFont.name)
          }
        })
      }
      // Legacy format: single fontName used for both header and body
      else if (font.fontName && Array.isArray(font.weights)) {
        const category = font.category || detectFontCategory(font.fontName)
        const fontInfo = {
          name: font.fontName,
          weights: font.weights,
          category
        }
        validFonts.push({
          id: font.id,
          name: font.name,
          description: font.description || '',
          headerFont: fontInfo,
          bodyFont: fontInfo
        })
      }
    }

    if (validFonts.length === 0) {
      throw new Error('No valid font pairings in LLM response')
    }

    // Validate fonts against Google Fonts API
    return await validateAndFilterFonts(validFonts, count)
  } catch (error) {
    logger.error('fontTheme.llm.parse_error', {
      error: error instanceof Error ? error.message : String(error),
      response: cleanedText.substring(0, 500)
    })
    throw new Error(`Failed to parse LLM font recommendations: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface FontInfo {
  name: string
  weights: string[]
  category: FontCategory
}

interface FontTheme {
  id: string
  name: string
  description: string
  headerFont?: FontInfo
  bodyFont?: FontInfo
  font?: FontInfo  // Legacy field for backwards compatibility
}

interface FontThemeGridWidget {
  widgetType: 'font-theme-grid'
  widgetData: {
    themes: FontTheme[]
  }
}

/**
 * Normalize a FontTheme to always have headerFont and bodyFont.
 * Handles backwards compatibility with legacy single-font themes.
 */
export function normalizeFontTheme(theme: FontTheme): { headerFont: FontInfo; bodyFont: FontInfo } {
  if (theme.headerFont && theme.bodyFont) {
    return { headerFont: theme.headerFont, bodyFont: theme.bodyFont }
  }
  // Legacy fallback: use single font for both
  if (!theme.font) {
    throw new Error('FontTheme must have either headerFont/bodyFont or font field')
  }
  return { headerFont: theme.font, bodyFont: theme.font }
}

/**
 * Professional font theme presets for websites with header/body pairings
 */
export const FONT_THEMES: Record<string, {
  name: string
  description: string
  headerFont: {
    name: string
    weights: string[]
    category: FontCategory
  }
  bodyFont: {
    name: string
    weights: string[]
    category: FontCategory
  }
  // Legacy field for backwards compatibility
  font?: {
    name: string
    weights: string[]
    category: FontCategory
    fallback: string
    googleFontsUrl: string
  }
}> = {
  'modern-professional': {
    name: 'Modern Professional',
    description: 'Clean sans-serif pairing. Perfect for tech, SaaS, and corporate sites.',
    headerFont: {
      name: 'Montserrat',
      weights: ['600', '700'],
      category: 'sans-serif'
    },
    bodyFont: {
      name: 'Inter',
      weights: ['400', '500', '600'],
      category: 'sans-serif'
    }
  },
  'elegant-serif': {
    name: 'Elegant Serif',
    description: 'Sophisticated serif pairing. Ideal for publishing, blogs, and editorial.',
    headerFont: {
      name: 'Playfair Display',
      weights: ['600', '700'],
      category: 'serif'
    },
    bodyFont: {
      name: 'Lora',
      weights: ['400', '500', '600'],
      category: 'serif'
    }
  },
  'bold-modern': {
    name: 'Bold Modern',
    description: 'Strong geometric headers with readable body. Great for agencies and portfolios.',
    headerFont: {
      name: 'Bebas Neue',
      weights: ['400'],
      category: 'sans-serif'
    },
    bodyFont: {
      name: 'Work Sans',
      weights: ['400', '500', '600'],
      category: 'sans-serif'
    }
  },
  'classic-formal': {
    name: 'Classic Formal',
    description: 'Traditional serif headers with clean body. Excellent for law, finance, luxury.',
    headerFont: {
      name: 'Merriweather',
      weights: ['700', '900'],
      category: 'serif'
    },
    bodyFont: {
      name: 'Source Sans 3',
      weights: ['400', '500', '600'],
      category: 'sans-serif'
    }
  }
}

/**
 * Persist font theme selection to the app plan.
 * Non-fatal: logs warnings on failure but never throws.
 */
async function persistFontThemeToPlan(
  appId: string,
  fontTheme: { name: string; headerFont: FontInfo; bodyFont: FontInfo },
  logEventPrefix: string
): Promise<void> {
  try {
    const persistResult = await appPlanTool.execute({
      appId,
      operation: 'update',
      fontTheme: {
        name: fontTheme.name,
        headerFont: fontTheme.headerFont,
        bodyFont: fontTheme.bodyFont
      }
    })
    if (persistResult.success) {
      logger.info(`${logEventPrefix}.persist.success`, {
        appId,
        themeName: fontTheme.name,
        headerFont: fontTheme.headerFont.name,
        bodyFont: fontTheme.bodyFont.name
      })
    } else {
      logger.warn(`${logEventPrefix}.persist.failure`, {
        appId,
        error: persistResult.error || persistResult.message
      })
    }
  } catch (error) {
    logger.warn(`${logEventPrefix}.persist.failure`, {
      appId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function updateCssFontVariables(
  appPath: string,
  headerFont: { name: string; weights: string[]; category: FontCategory },
  bodyFont: { name: string; weights: string[]; category: FontCategory }
): Promise<{ success: boolean; message: string }> {
  const cssPath = `${appPath}/src/styles/globals.css`

  try {
    let cssContent = await readFile(cssPath, 'utf8')

    // Remove ALL existing Google Fonts imports to avoid stacking
    cssContent = cssContent.replace(/@import url\('https:\/\/fonts\.googleapis\.com\/css2\?[^']+'\);\s*/g, '')

    // Build Google Fonts URL for both fonts (deduplicates if same)
    const googleFontsUrl = buildGoogleFontsUrl([
      { name: headerFont.name, weights: headerFont.weights },
      { name: bodyFont.name, weights: bodyFont.weights }
    ])

    // Add the new Google Fonts import at the top
    const googleFontsImport = `@import url('${googleFontsUrl}');\n\n`
    cssContent = googleFontsImport + cssContent

    // Get fallbacks for each font
    const headerFallback = getFallback(headerFont.category)
    const bodyFallback = getFallback(bodyFont.category)

    // Update or add --font-sans variable (body font)
    const fontSansRegex = /--font-sans:\s*[^;]+;/
    const newFontSans = `--font-sans: "${bodyFont.name}", ${bodyFallback};`

    if (fontSansRegex.test(cssContent)) {
      cssContent = cssContent.replace(fontSansRegex, newFontSans)
    } else {
      // Add --font-sans to :root in @layer base
      const rootBlockRegex = /(:root\s*\{)/
      if (rootBlockRegex.test(cssContent)) {
        const insertAfterRootRegex = /(:root\s*\{)(\s*(?:\/\*.*?\*\/)?\s*(?:--[^;]+;)?)/
        cssContent = cssContent.replace(insertAfterRootRegex, `$1$2\n    ${newFontSans}`)
      } else {
        const baseLayerRegex = /(@layer base\s*\{)/
        if (baseLayerRegex.test(cssContent)) {
          cssContent = cssContent.replace(baseLayerRegex, `$1\n  :root {\n    ${newFontSans}\n  }\n`)
        } else {
          throw new Error('Could not find suitable location to add font variables')
        }
      }
    }

    // Update or add --font-heading variable (header font)
    const fontHeadingRegex = /--font-heading:\s*[^;]+;/
    const newFontHeading = `--font-heading: "${headerFont.name}", ${headerFallback};`

    if (fontHeadingRegex.test(cssContent)) {
      cssContent = cssContent.replace(fontHeadingRegex, newFontHeading)
    } else {
      // Add --font-heading after --font-sans
      const fontSansLocationRegex = /(--font-sans:\s*[^;]+;)/
      if (fontSansLocationRegex.test(cssContent)) {
        cssContent = cssContent.replace(fontSansLocationRegex, `$1\n    ${newFontHeading}`)
      } else {
        const rootBlockRegex = /(:root\s*\{)/
        if (rootBlockRegex.test(cssContent)) {
          const insertAfterRootRegex = /(:root\s*\{)(\s*(?:\/\*.*?\*\/)?\s*(?:--[^;]+;)?)/
          cssContent = cssContent.replace(insertAfterRootRegex, `$1$2\n    ${newFontHeading}`)
        }
      }
    }

    // Ensure body uses --font-sans variable
    const bodyRuleRegex = /body \{([^}]*)\}/
    const bodyMatch = cssContent.match(bodyRuleRegex)

    if (bodyMatch && bodyMatch[1] !== undefined) {
      const bodyContent = bodyMatch[1]

      if (/font-family:/.test(bodyContent)) {
        cssContent = cssContent.replace(
          /body \{([^}]*?)font-family:[^;]+;([^}]*)\}/,
          'body {$1font-family: var(--font-sans);$2}'
        )
      } else {
        cssContent = cssContent.replace(
          bodyRuleRegex,
          `body {$1\n    font-family: var(--font-sans);
  }`
        )
      }
    } else {
      const bodyRule = `\n  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans);
  }`
      const baseLayerRegex = /(@layer base \{[\s\S]*?:root \{[\s\S]*?\})/
      if (baseLayerRegex.test(cssContent)) {
        cssContent = cssContent.replace(baseLayerRegex, `$1${bodyRule}`)
      }
    }

    // Ensure heading elements use --font-heading with !important
    const headingRule = `h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading) !important;
  }`

    const existingHeadingRuleRegex = /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-family[^}]*\}/

    if (existingHeadingRuleRegex.test(cssContent)) {
      cssContent = cssContent.replace(
        /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-family:[^;]+;[^}]*\}/,
        headingRule
      )
    } else {
      const bodyRuleRegex2 = /(body \{[^}]*\})/
      if (bodyRuleRegex2.test(cssContent)) {
        cssContent = cssContent.replace(bodyRuleRegex2, `$1\n\n  ${headingRule}`)
      } else if (cssContent.includes('@layer base')) {
        const baseLayerRegex2 = /(@layer base\s*\{)/
        cssContent = cssContent.replace(baseLayerRegex2, `$1\n\n  ${headingRule}\n`)
      }
    }

    await writeFile(cssPath, cssContent, 'utf8')

    const fontDescription = headerFont.name === bodyFont.name
      ? headerFont.name
      : `${headerFont.name} (headers) + ${bodyFont.name} (body)`

    logger.info('fontTheme.apply.success', {
      headerFont: headerFont.name,
      bodyFont: bodyFont.name
    })

    return {
      success: true,
      message: `Font theme applied: ${fontDescription}`
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
      const socketId = (context as any)?.socketId as string | undefined
      const subscriptionId = context?.metadata?.subscriptionId as string | undefined
      const customerId = context?.metadata?.customerId as string | undefined
      const budgetContext = extractBudgetContext(context as AgentContext | undefined)

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
        const agentId = context?.metadata?.agentId as string | undefined
        const customTags = context?.metadata?.tags as string[] | undefined
        const llmFonts = await generateFontsWithLLM(
          input.description,
          1,
          appId,
          sessionId,
          agentId,
          socketId,
          customTags,
          subscriptionId,
          customerId,
          budgetContext
        )

        if (llmFonts.length === 0) {
          throw new Error('Failed to generate font recommendation')
        }

        const selectedFont = llmFonts[0]!

        const app = await appRepo.findById(appId)
        if (!app) {
          throw new Error(`App not found: ${appId}`)
        }

        // Apply the font pairing
        const result = await updateCssFontVariables(app.path, selectedFont.headerFont, selectedFont.bodyFont)

        if (!result.success) {
          throw new Error(result.message)
        }

        const fontDescription = selectedFont.headerFont.name === selectedFont.bodyFont.name
          ? selectedFont.headerFont.name
          : `${selectedFont.headerFont.name} (headers) + ${selectedFont.bodyFont.name} (body)`

        // Persist font theme to app plan
        await persistFontThemeToPlan(
          appId,
          { name: selectedFont.name, headerFont: selectedFont.headerFont, bodyFont: selectedFont.bodyFont },
          'fontTheme.set'
        )

        // Persist to memory table for brand-data API (BrandDataTypography shape)
        try {
          await memoryRepo.set(appId, 'brand.typography', {
            heading: { family: selectedFont.headerFont.name, weights: selectedFont.headerFont.weights },
            body: { family: selectedFont.bodyFont.name, weights: selectedFont.bodyFont.weights },
          })
        } catch (error) {
          logger.warn('fontTheme.set.memory_write_failed', {
            appId,
            error: error instanceof Error ? error.message : String(error)
          })
        }

        logger.info('fontTheme.set.complete', {
          appId,
          headerFont: selectedFont.headerFont.name,
          bodyFont: selectedFont.bodyFont.name,
          themeName: selectedFont.name
        })

        return {
          success: true,
          message: `Applied font theme: ${selectedFont.name}`,
          appliedFont: {
            name: selectedFont.name,
            headerFont: selectedFont.headerFont,
            bodyFont: selectedFont.bodyFont
          },
          suggestedResponse: `Font theme "${selectedFont.name}" (${fontDescription}) has been applied.`
        }
      }

      if (input.mode === 'suggest') {
      if (input.description) {
        logger.info('fontTheme.suggest.llm.begin', {
          description: input.description,
          count: input.count
        })

        const suggestAgentId = context?.metadata?.agentId as string | undefined
        const suggestCustomTags = context?.metadata?.tags as string[] | undefined
        const llmFonts = await generateFontsWithLLM(
          input.description,
          input.count,
          appId,
          sessionId,
          suggestAgentId,
          socketId,
          suggestCustomTags,
          subscriptionId,
          customerId,
          budgetContext
        )

        const themes = llmFonts.map(font => ({
          id: font.id,
          name: font.name,
          description: font.description,
          headerFont: font.headerFont,
          bodyFont: font.bodyFont
        }))

        if (sessionId && stateManager?.storeSuggestedFonts) {
          const fontsToStore = themes.map(theme => ({
            name: theme.name,
            headerFont: theme.headerFont,
            bodyFont: theme.bodyFont,
            // Legacy fields for backwards compatibility
            fontName: theme.headerFont.name,
            weights: theme.headerFont.weights,
            category: theme.headerFont.category
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
        headerFont: theme.headerFont,
        bodyFont: theme.bodyFont
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

      let headerFont: FontInfo
      let bodyFont: FontInfo
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

      let skipValidation = false // Curated themes are pre-validated

      if (input.themeId && FONT_THEMES[input.themeId]) {
        const curatedTheme = FONT_THEMES[input.themeId]!
        headerFont = curatedTheme.headerFont
        bodyFont = curatedTheme.bodyFont
        themeName = curatedTheme.name
        skipValidation = true // Curated themes don't need HTTP validation

        logger.info('fontTheme.apply.curated', {
          appId,
          themeId: input.themeId
        })
      } else if (extractedThemeName && sessionId && stateManager?.getSuggestedFont) {
        const suggestedFont = stateManager.getSuggestedFont(sessionId, extractedThemeName)
        if (suggestedFont) {
          // Use headerFont/bodyFont if available (new format), fall back to legacy fontName/weights
          if (suggestedFont.headerFont && suggestedFont.bodyFont) {
            logger.info('fontTheme.apply.session_restored', {
              sessionId,
              themeName: extractedThemeName,
              headerFont: suggestedFont.headerFont.name,
              bodyFont: suggestedFont.bodyFont.name
            })
            headerFont = {
              ...suggestedFont.headerFont,
              category: (suggestedFont.headerFont.category || 'sans-serif') as FontCategory
            }
            bodyFont = {
              ...suggestedFont.bodyFont,
              category: (suggestedFont.bodyFont.category || 'sans-serif') as FontCategory
            }
          } else if (suggestedFont.fontName && suggestedFont.weights) {
            logger.info('fontTheme.apply.session_restored_legacy', {
              sessionId,
              themeName: extractedThemeName,
              fontName: suggestedFont.fontName
            })
            const fontInfo: FontInfo = {
              name: suggestedFont.fontName,
              weights: suggestedFont.weights,
              category: (suggestedFont.category || 'sans-serif') as FontCategory
            }
            headerFont = fontInfo
            bodyFont = fontInfo
          } else {
            throw new Error(`Font theme '${extractedThemeName}' found in session but has invalid data. Please use suggest mode first.`)
          }
          themeName = extractedThemeName
        } else if (input.fontName && input.weights) {
          logger.info('fontTheme.apply.fallback_to_explicit', {
            themeName: extractedThemeName,
            fontName: input.fontName,
            reason: 'Not found in session, using explicit fontName/weights from agent'
          })

          const category = detectFontCategory(input.fontName)
          const fontInfo: FontInfo = {
            name: input.fontName,
            weights: input.weights,
            category
          }
          headerFont = fontInfo
          bodyFont = fontInfo
          themeName = extractedThemeName
        } else {
          throw new Error(`Font theme '${extractedThemeName}' not found in session. Please use suggest mode first or provide fontName and weights.`)
        }
      } else if (input.fontName && input.weights) {
        const category = detectFontCategory(input.fontName)
        const fontInfo: FontInfo = {
          name: input.fontName,
          weights: input.weights,
          category
        }
        headerFont = fontInfo
        bodyFont = fontInfo
        themeName = input.fontName

        logger.info('fontTheme.apply.custom', {
          appId,
          fontName: input.fontName,
          weights: input.weights
        })
      } else {
        throw new Error(`Either themeId (for curated themes), themeName (from previous suggestion), or fontName + weights are required for apply mode.`)
      }

      // Validate fonts before applying them (skip for curated themes)
      if (!skipValidation) {
        const googleFontsUrl = buildGoogleFontsUrl([
          { name: headerFont.name, weights: headerFont.weights },
          { name: bodyFont.name, weights: bodyFont.weights }
        ])

        // Check cache first to avoid redundant HTTP calls
        const cachedIsValid = fontValidationCache.get(googleFontsUrl)
        let isValid = cachedIsValid

        if (isValid === undefined) {
          // Not in cache, validate via API
          const validation = await validateGoogleFontUrl(googleFontsUrl, `${headerFont.name} / ${bodyFont.name}`)

          if (!validation.valid) {
            const errorMessage = validation.networkError
              ? `Could not validate fonts due to network error. Please try again.`
              : `Invalid font selection: "${headerFont.name}" / "${bodyFont.name}" not found on Google Fonts or uses unsupported weights.`

            logger.error('fontTheme.apply.validation_failed', {
              appId,
              headerFont: headerFont.name,
              bodyFont: bodyFont.name,
              url: googleFontsUrl,
              networkError: validation.networkError
            })

            // Don't cache network errors
            if (!validation.networkError) {
              fontValidationCache.set(googleFontsUrl, false)
            }

            throw new Error(errorMessage)
          }

          // Cache successful validation
          fontValidationCache.set(googleFontsUrl, true)
          isValid = true
        }

        // Check if cached validation was false (invalid font)
        if (isValid === false) {
          logger.error('fontTheme.apply.validation_failed', {
            appId,
            headerFont: headerFont.name,
            bodyFont: bodyFont.name,
            url: googleFontsUrl,
            networkError: false,
            cached: true
          })
          throw new Error(`Invalid font selection: "${headerFont.name}" / "${bodyFont.name}" not found on Google Fonts or uses unsupported weights.`)
        }

        logger.info('fontTheme.apply.validation_passed', {
          appId,
          headerFont: headerFont.name,
          bodyFont: bodyFont.name,
          cached: cachedIsValid !== undefined
        })
      }

      const result = await updateCssFontVariables(app.path, headerFont, bodyFont)

      if (!result.success) {
        throw new Error(result.message)
      }

      // Persist font theme to app plan
      await persistFontThemeToPlan(appId, { name: themeName, headerFont, bodyFont }, 'fontTheme.apply')

      // Persist to memory table for brand-data API (BrandDataTypography shape)
      try {
        await memoryRepo.set(appId, 'brand.typography', {
          heading: { family: headerFont.name, weights: headerFont.weights },
          body: { family: bodyFont.name, weights: bodyFont.weights },
        })
      } catch (error) {
        logger.warn('fontTheme.apply.memory_write_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      return {
        success: true,
        message: `Applied "${themeName}" font theme successfully.`,
        themeId: input.themeId,
        themeName,
        headerFont: headerFont.name,
        bodyFont: bodyFont.name
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

