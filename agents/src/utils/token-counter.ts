/**
 * Token counting utility for AI models
 * Uses ai-tokenizer for accurate cross-model token counting with AI SDK support
 */

import { Tokenizer, models } from 'ai-tokenizer'
import * as cl100k from 'ai-tokenizer/encoding/cl100k_base'
import * as claude from 'ai-tokenizer/encoding/claude'
import * as o200k from 'ai-tokenizer/encoding/o200k_base'

import { Logger } from '../logging/index.js'

const logger = Logger.create({ service: 'token-counter' })

/**
 * Model provider type
 */
export type ModelProvider = 'openai' | 'anthropic' | 'bedrock-claude' | 'openai-compatible'

/**
 * Token counting result
 */
export interface TokenCountResult {
  tokenCount: number
  provider: ModelProvider
  normalizedModelName: string
}

// Cached tokenizers for performance
const claudeTokenizer = new Tokenizer(claude)
const openaiTokenizer = new Tokenizer(o200k)
const glmTokenizer = new Tokenizer(cl100k)

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
  'claude-3-opus': 'anthropic/claude-3-opus',
  'claude-3-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-3-haiku': 'anthropic/claude-3-haiku',
  'claude-3-5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-3-5-haiku': 'anthropic/claude-3.5-haiku',
  'claude-sonnet-4': 'anthropic/claude-sonnet-4',
  'claude-sonnet-4-5': 'anthropic/claude-sonnet-4.5',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  // Gemini models
  'gemini-3-flash-preview': 'google/gemini-3-pro-preview',
  'gemini-3-pro-preview': 'google/gemini-3-pro-preview',
  // GLM models
  'zai-glm-4.7': 'zai/glm-4.5',
}

/**
 * Normalize model names to their canonical forms
 */
function normalizeModelName(modelName: string): { normalizedName: string; provider: ModelProvider } {
  const lowerModel = modelName.toLowerCase().trim()

  // OpenAI model mappings
  const openaiModels: Record<string, string> = {
    'gpt-4o': 'gpt-4o',
    'gpt4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt4o-mini': 'gpt-4o-mini',
    'gpt-4': 'gpt-4',
    'gpt4': 'gpt-4',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
    'gpt35': 'gpt-3.5-turbo',
    'gpt-35-turbo': 'gpt-3.5-turbo',
  }

  // OpenAI-compatible models (Gemini and GLM)
  const openaiCompatibleModels: Record<string, string> = {
    // Gemini models
    'gemini-3-flash-preview': 'gemini-3-flash-preview',
    'gemini3-flash': 'gemini-3-flash-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
    'gemini3-pro': 'gemini-3-pro-preview',
    'gemini-3-pro': 'gemini-3-pro-preview',
    // GLM models
    'zai-glm-4.7': 'zai-glm-4.7',
    'priv/cb.zai-glm-4.7': 'zai-glm-4.7',
    'glm-4.7': 'zai-glm-4.7',
    'glm4.7': 'zai-glm-4.7',
  }

  // Check OpenAI models first
  if (openaiModels[lowerModel]) {
    return { normalizedName: openaiModels[lowerModel], provider: 'openai' }
  }

  // Check OpenAI-compatible models
  if (openaiCompatibleModels[lowerModel]) {
    return { normalizedName: openaiCompatibleModels[lowerModel], provider: 'openai-compatible' }
  }

  // Bedrock Claude model patterns (full ARN-like names)
  if (lowerModel.includes('anthropic.claude')) {
    if (lowerModel.includes('claude-sonnet-4-5')) {
      return { normalizedName: 'claude-sonnet-4-5', provider: 'bedrock-claude' }
    }
    if (lowerModel.includes('claude-haiku-4-5')) {
      return { normalizedName: 'claude-haiku-4-5', provider: 'bedrock-claude' }
    }
    if (lowerModel.includes('claude-sonnet-4')) {
      return { normalizedName: 'claude-sonnet-4', provider: 'bedrock-claude' }
    }
    if (lowerModel.includes('claude-3-5-sonnet')) {
      return { normalizedName: 'claude-3-5-sonnet', provider: 'bedrock-claude' }
    }
    if (lowerModel.includes('claude-3-5-haiku')) {
      return { normalizedName: 'claude-3-5-haiku', provider: 'bedrock-claude' }
    }
    if (lowerModel.includes('claude-3-haiku')) {
      return { normalizedName: 'claude-3-haiku', provider: 'bedrock-claude' }
    }
    if (lowerModel.includes('claude-3-sonnet')) {
      return { normalizedName: 'claude-3-sonnet', provider: 'bedrock-claude' }
    }
    if (lowerModel.includes('claude-3-opus')) {
      return { normalizedName: 'claude-3-opus', provider: 'bedrock-claude' }
    }
  }

  // Anthropic model mappings
  const anthropicModels: Record<string, string> = {
    'claude-3-opus': 'claude-3-opus',
    'claude-3-sonnet': 'claude-3-sonnet',
    'claude-3-haiku': 'claude-3-haiku',
    'claude-3-5-sonnet': 'claude-3-5-sonnet',
    'claude-3.5-sonnet': 'claude-3-5-sonnet',
    'claude-3-5-haiku': 'claude-3-5-haiku',
    'claude-sonnet-4': 'claude-sonnet-4',
    'claude-sonnet-4-20250514': 'claude-sonnet-4',
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5',
    'claude-haiku-4-5': 'claude-haiku-4-5',
    'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
    // Aliases
    'claude4': 'claude-sonnet-4',
    'sonnet4': 'claude-sonnet-4',
    'claude35-sonnet': 'claude-3-5-sonnet',
    'claude-haiku': 'claude-3-5-haiku',
    'claude3-haiku': 'claude-3-haiku',
    'haiku': 'claude-haiku-4-5',
    'sonnet': 'claude-sonnet-4-5'
  }

  if (anthropicModels[lowerModel]) {
    return { normalizedName: anthropicModels[lowerModel], provider: 'anthropic' }
  }

  // Default to OpenAI if unrecognized
  logger.warn('token-counter.model.unknown', {
    modelName,
    fallback: 'gpt-4o',
  })
  return { normalizedName: 'gpt-4o', provider: 'openai' }
}

/**
 * Get the appropriate tokenizer for a model
 */
function getTokenizer(normalizedName: string, provider: ModelProvider): Tokenizer {
  // GLM models use cl100k encoding
  if (normalizedName.includes('glm')) {
    return glmTokenizer
  }

  switch (provider) {
    case 'anthropic':
    case 'bedrock-claude':
      return claudeTokenizer
    case 'openai':
    case 'openai-compatible':
    default:
      return openaiTokenizer
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
 * const result1 = countTokens("Hello world", "gpt-4o")
 * const result2 = countTokens("Hello world", "gpt4o-mini") // alias supported
 *
 * // Anthropic models
 * const result3 = countTokens("Hello world", "claude-3-5-sonnet")
 * const result4 = countTokens("Hello world", "sonnet4") // alias supported
 *
 * // Bedrock models (full ARN)
 * const result5 = countTokens("Hello world", "us.anthropic.claude-3-5-sonnet-20240620-v1:0")
 * ```
 */
export function countTokens(text: string, modelName: string): TokenCountResult {
  if (!text || typeof text !== 'string') {
    return {
      tokenCount: 0,
      provider: 'openai',
      normalizedModelName: modelName
    }
  }

  const { normalizedName, provider } = normalizeModelName(modelName)

  let tokenCount: number

  // Check if model has native ai-tokenizer support
  const tokenizerModelName = MODEL_TO_TOKENIZER[normalizedName]
  if (tokenizerModelName && tokenizerModelName in models) {
    try {
      tokenCount = getTokenizer(normalizedName, provider).count(text)
    } catch (error) {
      logger.warn('token-counter.ai-tokenizer.error', {
        normalizedName,
        error: error instanceof Error ? error.message : String(error),
        fallback: 'character approximation',
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
export function countTotalTokens(texts: string[], modelName: string): TokenCountResult {
  return countTokens(texts.join(''), modelName)
}

/**
 * Get approximate token count without specifying model (uses rough approximation)
 * Useful for quick estimates when model type is unknown
 *
 * @param text - The text to estimate tokens for
 * @returns Approximate token count (1 token ≈ 4 characters)
 */
export function estimateTokens(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0
  }
  return Math.ceil(text.length / 4)
}
