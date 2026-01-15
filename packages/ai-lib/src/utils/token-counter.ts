/**
 * Token counting utility for AI models
 * Uses ai-tokenizer for accurate cross-model token counting with AI SDK support
 */

import { Tokenizer, models } from 'ai-tokenizer'
import * as cl100k from 'ai-tokenizer/encoding/cl100k_base'
import * as claude from 'ai-tokenizer/encoding/claude'
import * as o200k from 'ai-tokenizer/encoding/o200k_base'

import { normalizeModelName, type ModelProvider } from './model-normalization.js'
import { createLogger } from './logger.js'

const logger = createLogger('token-counter')

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
  | 'claude-3-opus'
  | 'claude-3-sonnet'
  | 'claude-3-haiku'
  | 'claude-3-5-sonnet'
  | 'claude-3-5-haiku'
  | 'claude-sonnet-4'
  | 'claude-sonnet-4-5'
  | 'claude-haiku-4-5'
  // Bedrock Claude Models (full names)
  | 'us.anthropic.claude-3-5-sonnet-20240620-v1:0'
  | 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
  | 'global.anthropic.claude-sonnet-4-20250514-v1:0'
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

  const modelInfo = normalizeModelName(modelName)
  const normalizedName = modelInfo.normalizedName
  const provider = modelInfo.provider

  let tokenCount: number

  // Check if model has native ai-tokenizer support
  const tokenizerModelName = MODEL_TO_TOKENIZER[normalizedName]
  if (tokenizerModelName && tokenizerModelName in models) {
    try {
      tokenCount = getTokenizer(normalizedName, provider).count(text)
    } catch (error) {
      logger.warn(`Error counting tokens with ai-tokenizer for "${normalizedName}", using approximation`, error)
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
 * Count tokens for a conversation (array of messages)
 * Each message should have a 'content' field
 *
 * @param messages - Array of message objects with content
 * @param modelName - The model name
 * @returns Total token count for the conversation
 */
export function countConversationTokens(
  messages: Array<{ content: string; role?: string }>,
  modelName: string
): TokenCountResult {
  const allContent = messages
    .map(msg => msg.content || '')
    .filter(content => content.trim().length > 0)

  return countTotalTokens(allContent, modelName)
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

/**
 * Check if a model is supported for accurate token counting
 */
export function isTokenCountingSupported(modelName: string): boolean {
  try {
    const modelInfo = normalizeModelName(modelName)
    const tokenizerModelName = MODEL_TO_TOKENIZER[modelInfo.normalizedName]
    return Boolean(tokenizerModelName && tokenizerModelName in models)
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
