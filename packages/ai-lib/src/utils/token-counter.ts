/**
 * Token counting utility for AI models
 * Uses ai-tokenizer for accurate cross-model token counting with AI SDK support
 *
 * Tokenizer modules are loaded dynamically on-demand to reduce initial bundle size
 * and startup time. Only the tokenizer needed for the specific model is loaded.
 */

import { normalizeModelName, type ModelProvider } from './model-normalization.js'
import { createLogger } from '@airo/ai-common'

const logger = createLogger('token-counter')

// Types from ai-tokenizer (imported dynamically)
type TokenizerInstance = {
  count(text: string): number
}
 
type TokenizerClass = new (...args: any[]) => TokenizerInstance

// Lazy-loaded tokenizer instances (one per encoding type)
let claudeTokenizer: TokenizerInstance | null = null
let openaiTokenizer: TokenizerInstance | null = null
let glmTokenizer: TokenizerInstance | null = null

// Cached Tokenizer class and models registry
let TokenizerConstructor: TokenizerClass | null = null
let models: Record<string, unknown> | null = null

// In-flight promises to prevent duplicate loading
const loadingPromises: Record<string, Promise<TokenizerInstance>> = {}

/**
 * Load the core ai-tokenizer module (Tokenizer class and models registry)
 */
async function ensureCoreLoaded(): Promise<void> {
  if (TokenizerConstructor && models) {
    return
  }

  const { Tokenizer, models: loadedModels } = await import('ai-tokenizer')
  TokenizerConstructor = Tokenizer
  models = loadedModels
}

/**
 * Get or create the Claude tokenizer (lazy-loaded)
 */
async function getClaudeTokenizer(): Promise<TokenizerInstance> {
  if (claudeTokenizer) {
    return claudeTokenizer
  }

  if (loadingPromises['claude']) {
    return loadingPromises['claude']
  }

  loadingPromises['claude'] = (async () => {
    try {
      await ensureCoreLoaded()
      const claude = await import('ai-tokenizer/encoding/claude')
      claudeTokenizer = new TokenizerConstructor!(claude)
      return claudeTokenizer
    } catch (error) {
      // Clear the promise so retry is possible
      delete loadingPromises['claude']
      throw error
    }
  })()

  return loadingPromises['claude']
}

/**
 * Get or create the OpenAI tokenizer (lazy-loaded, uses o200k_base encoding)
 */
async function getOpenAITokenizer(): Promise<TokenizerInstance> {
  if (openaiTokenizer) {
    return openaiTokenizer
  }

  if (loadingPromises['openai']) {
    return loadingPromises['openai']
  }

  loadingPromises['openai'] = (async () => {
    try {
      await ensureCoreLoaded()
      const o200k = await import('ai-tokenizer/encoding/o200k_base')
      openaiTokenizer = new TokenizerConstructor!(o200k)
      return openaiTokenizer
    } catch (error) {
      // Clear the promise so retry is possible
      delete loadingPromises['openai']
      throw error
    }
  })()

  return loadingPromises['openai']
}

/**
 * Get or create the GLM tokenizer (lazy-loaded, uses cl100k_base encoding)
 */
async function getGLMTokenizer(): Promise<TokenizerInstance> {
  if (glmTokenizer) {
    return glmTokenizer
  }

  if (loadingPromises['glm']) {
    return loadingPromises['glm']
  }

  loadingPromises['glm'] = (async () => {
    try {
      await ensureCoreLoaded()
      const cl100k = await import('ai-tokenizer/encoding/cl100k_base')
      glmTokenizer = new TokenizerConstructor!(cl100k)
      return glmTokenizer
    } catch (error) {
      // Clear the promise so retry is possible
      delete loadingPromises['glm']
      throw error
    }
  })()

  return loadingPromises['glm']
}

/**
 * Supported model types for token counting
 */
export type SupportedModel =
  // OpenAI Models
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  // Anthropic Models
  | 'claude-sonnet-4-5'
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5'
  // Gemini Models (via OpenAI-compatible provider)
  | 'gemini-3-flash-preview'
  | 'gemini-3-pro-preview'
  // GLM Models (via OpenAI-compatible provider)
  | 'zai-glm-4.7'

/**
 * Re-export ModelProvider type for compatibility
 */
export type { ModelProvider }

/**
 * Token counting result
 */
export interface TokenCountResult {
  tokenCount: number
  provider: ModelProvider
  normalizedModelName: string
}

/**
 * Map our normalized model names to ai-tokenizer model names
 */
const MODEL_TO_TOKENIZER: Record<string, string> = {
  // OpenAI models
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4': 'openai/gpt-4-turbo',
  'gpt-4-turbo': 'openai/gpt-4-turbo',
  'gpt-3.5-turbo': 'openai/gpt-4-turbo',
  // Claude models
  'claude-sonnet-4-5': 'anthropic/claude-sonnet-4.5',
  'claude-opus-4-6': 'anthropic/claude-sonnet-4.5', // ai-tokenizer doesn't include opus 4.6 yet; same tokenizer family
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.5', // ai-tokenizer@1.0.6 doesn't include 4.6 yet; same tokenizer as 4.5
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  // Gemini models
  'gemini-3-flash-preview': 'google/gemini-3-pro-preview',
  'gemini-3-pro-preview': 'google/gemini-3-pro-preview',
  // GLM models
  'zai-glm-4.7': 'zai/glm-4.5',
}

/**
 * Get the appropriate tokenizer for a model (lazy-loaded)
 */
async function getTokenizer(normalizedName: string, provider: ModelProvider): Promise<TokenizerInstance> {
  // GLM models use cl100k encoding
  if (normalizedName.includes('glm')) {
    return getGLMTokenizer()
  }

  switch (provider) {
    case 'anthropic':
      return getClaudeTokenizer()
    case 'openai':
    default:
      return getOpenAITokenizer()
  }
}

/**
 * Count tokens for a given text and model
 *
 * @param text - The text to count tokens for
 * @param modelName - The model name (supports aliases and full ARN names)
 * @returns Token count result with provider information
 *
 * @example
 * ```typescript
 * // OpenAI models
 * const result1 = await countTokens("Hello world", "gpt-4o")
 * const result2 = await countTokens("Hello world", "gpt4o-mini") // alias supported
 *
 * // Anthropic models
 * const result3 = await countTokens("Hello world", "claude-sonnet-4-6")
 * const result4 = await countTokens("Hello world", "sonnet") // alias supported
 * ```
 */
export async function countTokens(text: string, modelName: string): Promise<TokenCountResult> {
  if (!text || typeof text !== 'string') {
    return {
      tokenCount: 0,
      provider: 'openai',
      normalizedModelName: modelName
    }
  }

  const modelInfo = normalizeModelName(modelName)
  const normalizedName = modelInfo.normalizedName
  const provider = modelInfo.provider

  let tokenCount: number

  // Check if model has native ai-tokenizer support via our static mapping.
  // We use MODEL_TO_TOKENIZER as the source of truth rather than the ai-tokenizer
  // models registry because: (1) we control which models we support, (2) the registry
  // is lazy-loaded so checking it would require loading the library, and (3) runtime
  // failures are handled gracefully via the try/catch with character approximation fallback.
  const tokenizerModelName = MODEL_TO_TOKENIZER[normalizedName]
  if (tokenizerModelName) {
    try {
      const tokenizer = await getTokenizer(normalizedName, provider)
      tokenCount = tokenizer.count(text)
    } catch (error) {
      logger.warn('token-counter.count.failure', {
        normalizedName,
        error: error instanceof Error ? error.message : String(error),
        fallback: 'character approximation'
      })
      tokenCount = Math.ceil(text.length / 4)
    }
  } else {
    // Character approximation for unsupported models
    tokenCount = Math.ceil(text.length / 4)
  }

  return {
    tokenCount,
    provider,
    normalizedModelName: normalizedName
  }
}

/**
 * Count tokens for multiple texts and return the total
 *
 * @param texts - Array of texts to count tokens for
 * @param modelName - The model name
 * @returns Total token count across all texts
 */
export async function countTotalTokens(texts: string[], modelName: string): Promise<TokenCountResult> {
  return countTokens(texts.join(''), modelName)
}

/**
 * Count tokens for a conversation (array of messages)
 * Each message should have a 'content' field
 *
 * @param messages - Array of message objects with content
 * @param modelName - The model name
 * @returns Total token count for the conversation
 */
export async function countConversationTokens(
  messages: Array<{ content: string; role?: string }>,
  modelName: string
): Promise<TokenCountResult> {
  const allContent = messages
    .map(msg => msg.content || '')
    .filter(content => content.trim().length > 0)

  return countTotalTokens(allContent, modelName)
}

/**
 * Check if a model is supported for accurate token counting.
 * This is a synchronous convenience check that only verifies the model exists
 * in our static MODEL_TO_TOKENIZER mapping. It does NOT verify that the model
 * is actually supported by the ai-tokenizer library at runtime - that verification
 * happens when countTokens() is called and any failures fall back to character
 * approximation. Use this for quick pre-checks; actual support is determined at runtime.
 */
export function isTokenCountingSupported(modelName: string): boolean {
  try {
    const modelInfo = normalizeModelName(modelName)
    return modelInfo.normalizedName in MODEL_TO_TOKENIZER
  } catch {
    return false
  }
}

/**
 * Get the provider for a given model name
 */
export function getModelProvider(modelName: string): ModelProvider {
  return normalizeModelName(modelName).provider
}
