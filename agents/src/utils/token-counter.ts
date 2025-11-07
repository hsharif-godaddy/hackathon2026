/**
 * Token counting utility for AI models
 * Uses tiktoken for OpenAI models and @anthropic-ai/tokenizer for Anthropic models
 */

import { encoding_for_model, type TiktokenModel } from 'tiktoken'
import { countTokens as countAnthropicTokens } from '@anthropic-ai/tokenizer'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ service: 'token-counter' })

/**
 * Model provider type
 */
export type ModelProvider = 'openai' | 'anthropic' | 'bedrock-claude'

/**
 * Token counting result
 */
export interface TokenCountResult {
  tokenCount: number
  provider: ModelProvider
  normalizedModelName: string
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
  
  // Check OpenAI models first
  if (openaiModels[lowerModel]) {
    return { normalizedName: openaiModels[lowerModel], provider: 'openai' }
  }
  
  // Bedrock Claude model patterns (full ARN-like names)
  if (lowerModel.includes('anthropic.claude')) {
    // Extract the base model type from bedrock ARNs (check newer models first)
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
  
  // Anthropic model mappings (short names and aliases)
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
  
  // Default to OpenAI if unrecognized (fallback behavior)
  logger.warn('token-counter.model.unknown', {
    modelName,
    fallback: 'gpt-4o',
  })
  return { normalizedName: 'gpt-4o', provider: 'openai' }
}

/**
 * Get tiktoken model name for OpenAI models
 */
function getTiktokenModelName(normalizedName: string): TiktokenModel {
  // Map our normalized names to tiktoken's expected model names
  const tiktokenMap: Record<string, TiktokenModel> = {
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-4': 'gpt-4',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-3.5-turbo': 'gpt-3.5-turbo'
  }
  
  const tiktokenModel = tiktokenMap[normalizedName]
  if (!tiktokenModel) {
    logger.warn('token-counter.tiktoken.model-not-found', {
      normalizedName,
      fallback: 'gpt-4o',
    })
    return 'gpt-4o'
  }
  
  return tiktokenModel
}

/**
 * Count tokens for OpenAI models using tiktoken
 */
function countOpenAITokens(text: string, modelName: string): number {
  try {
    const tiktokenModel = getTiktokenModelName(modelName)
    const encoding = encoding_for_model(tiktokenModel)
    const tokens = encoding.encode(text)
    encoding.free() // Free memory
    return tokens.length
  } catch (error) {
    logger.error('token-counter.openai.count-error', {
      modelName,
      error: error instanceof Error ? error.message : String(error),
      fallback: 'character approximation',
    })
    // Fallback to rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4)
  }
}

/**
 * Count tokens for Anthropic models using @anthropic-ai/tokenizer
 * Note: This tokenizer is most accurate for older Claude models.
 * For Claude 3+ models, consider using the usage field from API responses when available.
 */
function countAnthropicTokensWrapper(text: string, modelName: string): number {
  try {
    return countAnthropicTokens(text)
  } catch (error) {
    logger.error('token-counter.anthropic.count-error', {
      modelName,
      error: error instanceof Error ? error.message : String(error),
      fallback: 'character approximation',
    })
    // Fallback to rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4)
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
  
  switch (provider) {
    case 'openai':
      tokenCount = countOpenAITokens(text, normalizedName)
      break
      
    case 'anthropic':
    case 'bedrock-claude':
      tokenCount = countAnthropicTokensWrapper(text, normalizedName)
      break
      
    default:
      // Fallback
      tokenCount = Math.ceil(text.length / 4)
      break
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
  const totalText = texts.join('')
  return countTokens(totalText, modelName)
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
