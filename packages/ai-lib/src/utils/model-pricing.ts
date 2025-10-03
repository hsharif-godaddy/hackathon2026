/**
 * Model Pricing and Cost Estimation Utility
 * 
 * Provides accurate cost calculations for different AI models including cache optimizations.
 * Pricing information is kept up-to-date with provider pricing as of January 2024.
 */

import { 
  normalizeModelName, 
  type ModelProvider
} from './model-normalization.js'

/**
 * Token usage information from AI SDK
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokensRead?: number
  cachedInputTokensWrite?: number
}

/**
 * Cost calculation result
 */
export interface CostEstimate {
  inputCost: number
  outputCost: number
  totalCost: number
  cachedInputCost?: number
  regularCost: number // Cost without caching
  savings: number // Amount saved from caching
  savingsPercentage: number // Percentage saved from caching
  currency: string
  model: string
  provider: ModelProvider
}

/**
 * Pricing structure for a model
 */
interface ModelPricing {
  inputCostPer1K: number // Cost per 1000 input tokens
  outputCostPer1K: number // Cost per 1000 output tokens  
  cachedInputReadCostPer1K?: number // Cost per 1000 cached input tokens (if different)
  cachedInputWriteCostPer1K?: number // Cost per 1000 cached input tokens (if different)
  currency: string
}

/**
 * Model pricing database
 * Updated as of January 2024
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI Models
  'gpt-4o': {
    inputCostPer1K: 0.005,
    outputCostPer1K: 0.015,
    currency: 'USD'
  },
  'gpt-4o-mini': {
    inputCostPer1K: 0.000150,
    outputCostPer1K: 0.000600,
    currency: 'USD'
  },
  'gpt-4': {
    inputCostPer1K: 0.03,
    outputCostPer1K: 0.06,
    currency: 'USD'
  },
  'gpt-4-turbo': {
    inputCostPer1K: 0.01,
    outputCostPer1K: 0.03,
    currency: 'USD'
  },
  'gpt-3.5-turbo': {
    inputCostPer1K: 0.0015,
    outputCostPer1K: 0.002,
    currency: 'USD'
  },

  // Anthropic Models (via Anthropic API)
  'claude-sonnet-4': {
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.075,
    currency: 'USD'
  },
  'claude-3-5-sonnet': {
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    currency: 'USD'
  },
  'claude-3-5-haiku': {
    inputCostPer1K: 0.0008,
    outputCostPer1K: 0.004,
    currency: 'USD'
  },
}

/**
 * Bedrock pricing (different from Anthropic direct API)
 */
const BEDROCK_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4': {
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.075,
    cachedInputReadCostPer1K: 0.0003, 
    cachedInputWriteCostPer1K: 0.00375,
    currency: 'USD'
  },
  'claude-3-5-sonnet': {
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    currency: 'USD'
  },
  'claude-3-5-haiku': {
    inputCostPer1K: 0.0008,
    outputCostPer1K: 0.015,
    cachedInputReadCostPer1K: 0.0003,
    cachedInputWriteCostPer1K: 0.00375,
    currency: 'USD'
  },
}


/**
 * Get pricing information for a model
 */
function getModelPricing(modelName: string): ModelPricing | null {
  const modelInfo = normalizeModelName(modelName, true) // Prefer Bedrock for caching support
  const normalizedName = modelInfo.normalizedName
  const provider = modelInfo.provider
  
  // Use Bedrock pricing for Bedrock models (includes caching discounts)
  if (provider === 'bedrock-claude' && BEDROCK_PRICING[normalizedName]) {
    return BEDROCK_PRICING[normalizedName]
  }
  
  // Use regular pricing for other providers
  if (MODEL_PRICING[normalizedName]) {
    return MODEL_PRICING[normalizedName]
  }
  
  return null
}

/**
 * Calculate cost estimate for token usage
 */
export function calculateCostEstimate(
  usage: TokenUsage,
  modelName: string
): CostEstimate {
  const modelInfo = normalizeModelName(modelName, true) // Prefer Bedrock for caching support
  const provider = modelInfo.provider
  const pricing = getModelPricing(modelName)
  
  if (!pricing) {
    // Return zero cost for unsupported models
    return {
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      regularCost: 0,
      savings: 0,
      savingsPercentage: 0,
      currency: 'USD',
      model: modelName,
      provider
    }
  }
  
  // Calculate basic costs
  const inputCost = (usage.inputTokens / 1000) * pricing.inputCostPer1K
  const outputCost = (usage.outputTokens / 1000) * pricing.outputCostPer1K
  
  // Calculate cached input cost if applicable
  let cachedInputCost = 0
  const regularCost = inputCost + outputCost
  
  const totalCachedInputTokens = (usage.cachedInputTokensRead || 0) + (usage.cachedInputTokensWrite || 0)
  
  if (totalCachedInputTokens > 0 && (pricing.cachedInputReadCostPer1K !== undefined || pricing.cachedInputWriteCostPer1K !== undefined)) {
    // Calculate cost for cached tokens (usually much cheaper)
    const regularInputTokens = usage.inputTokens - totalCachedInputTokens
    const regularInputCost = Math.max(0, (regularInputTokens / 1000) * pricing.inputCostPer1K)
    
    // Calculate cached read cost
    let cachedReadCost = 0
    if (usage.cachedInputTokensRead && pricing.cachedInputReadCostPer1K !== undefined) {
      cachedReadCost = (usage.cachedInputTokensRead / 1000) * pricing.cachedInputReadCostPer1K
    }
    
    // Calculate cached write cost  
    let cachedWriteCost = 0
    if (usage.cachedInputTokensWrite && pricing.cachedInputWriteCostPer1K !== undefined) {
      cachedWriteCost = (usage.cachedInputTokensWrite / 1000) * pricing.cachedInputWriteCostPer1K
    }
    
    cachedInputCost = cachedReadCost + cachedWriteCost
    const totalCost = regularInputCost + cachedInputCost + outputCost
    const savings = regularCost - totalCost
    
    return {
      inputCost: regularInputCost,
      outputCost,
      totalCost,
      cachedInputCost,
      regularCost,
      savings,
      savingsPercentage: (savings / regularCost) * 100,
      currency: pricing.currency,
      model: modelName,
      provider
    }
  }
  
  // No caching
  return {
    inputCost,
    outputCost,
    totalCost: regularCost,
    regularCost,
    savings: 0,
    savingsPercentage: 0,
    currency: pricing.currency,
    model: modelName,
    provider
  }
}

/**
 * Format cost estimate for logging
 */
export function formatCostEstimate(estimate: CostEstimate, usage?: TokenUsage): string[] {
  const lines: string[] = []
  
  lines.push(`📊 Cost Analysis for ${estimate.model}:`)
  lines.push(`   Input cost: $${estimate.inputCost.toFixed(4)}`)
  lines.push(`   Output cost: $${estimate.outputCost.toFixed(4)}`)
  
  if (estimate.cachedInputCost !== undefined) {
    lines.push(`   Cached input cost: $${estimate.cachedInputCost.toFixed(4)}`)
    
    // Show breakdown of read vs write if usage is provided
    if (usage) {
      if (usage.cachedInputTokensRead && usage.cachedInputTokensWrite) {
        lines.push(`     • Read: ${usage.cachedInputTokensRead} tokens`)
        lines.push(`     • Write: ${usage.cachedInputTokensWrite} tokens`)
      } else if (usage.cachedInputTokensRead) {
        lines.push(`     • Read: ${usage.cachedInputTokensRead} tokens`)
      } else if (usage.cachedInputTokensWrite) {
        lines.push(`     • Write: ${usage.cachedInputTokensWrite} tokens`)
      }
    }
    
    lines.push(`   💰 Total cost (with caching): $${estimate.totalCost.toFixed(4)}`)
    lines.push(`   💸 Cost without caching: $${estimate.regularCost.toFixed(4)}`)
    lines.push(`   ✨ Savings: $${estimate.savings.toFixed(4)} (${estimate.savingsPercentage.toFixed(1)}%)`)
  } else {
    lines.push(`   💰 Total cost: $${estimate.totalCost.toFixed(4)}`)
  }
  
  return lines
}

/**
 * Get cache hit rate from usage
 */
export function getCacheHitRate(usage: TokenUsage): number {
  const totalCachedTokens = (usage.cachedInputTokensRead || 0) + (usage.cachedInputTokensWrite || 0)
  if (totalCachedTokens === 0 || usage.inputTokens === 0) {
    return 0
  }
  return (totalCachedTokens / usage.inputTokens) * 100
}

/**
 * Check if a model supports caching
 */
export function modelSupportsCaching(modelName: string): boolean {
  const modelInfo = normalizeModelName(modelName, true) // Prefer Bedrock for caching support
  
  // Only Bedrock Claude models currently support caching
  const pricing = BEDROCK_PRICING[modelInfo.normalizedName]
  return modelInfo.provider === 'bedrock-claude' && 
         !!pricing && 
         (pricing.cachedInputReadCostPer1K !== undefined || pricing.cachedInputWriteCostPer1K !== undefined)
}

/**
 * Get available models with pricing information
 */
export function getAvailableModelsWithPricing(): Array<{
  name: string
  provider: ModelProvider
  inputCostPer1K: number
  outputCostPer1K: number
  supportsCaching: boolean
  currency: string
}> {
  const models: Array<{
    name: string
    provider: ModelProvider
    inputCostPer1K: number
    outputCostPer1K: number
    supportsCaching: boolean
    currency: string
  }> = []
  
  // Add regular models
  for (const [name, pricing] of Object.entries(MODEL_PRICING)) {
    const modelInfo = normalizeModelName(name)
    models.push({
      name,
      provider: modelInfo.provider,
      inputCostPer1K: pricing.inputCostPer1K,
      outputCostPer1K: pricing.outputCostPer1K,
      supportsCaching: false,
      currency: pricing.currency
    })
  }
  
  // Add Bedrock models (with caching support)
  for (const [name, pricing] of Object.entries(BEDROCK_PRICING)) {
    models.push({
      name: `${name} (Bedrock)`,
      provider: 'bedrock-claude' as ModelProvider,
      inputCostPer1K: pricing.inputCostPer1K,
      outputCostPer1K: pricing.outputCostPer1K,
      supportsCaching: pricing.cachedInputReadCostPer1K !== undefined || pricing.cachedInputWriteCostPer1K !== undefined,
      currency: pricing.currency
    })
  }
  
  return models.sort((a, b) => a.name.localeCompare(b.name))
}