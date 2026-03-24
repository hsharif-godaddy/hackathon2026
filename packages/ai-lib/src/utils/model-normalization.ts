/**
 * Unified Model Name Normalization System
 * 
 * Centralizes all model name normalization logic to ensure consistency
 * across providers, token counting, and pricing calculations.
 */

/**
 * Supported model providers
 */
export type ModelProvider = 'openai' | 'anthropic' | 'bedrock-claude'

/**
 * Model normalization result
 */
export interface ModelInfo {
  /** Canonical model name */
  normalizedName: string
  /** Full model identifier (for providers) */
  fullModelId: string
  /** Model provider type */
  provider: ModelProvider
  /** Whether this model is recognized */
  isSupported: boolean
  /** Original input name */
  originalName: string
}

/**
 * Model definition with provider-specific identifiers
 */
interface ModelDefinition {
  /** Canonical normalized name */
  normalizedName: string
  /** OpenAI model ID */
  openai?: string
  /** Anthropic API model ID */
  anthropic?: string
  /** Bedrock model ARN */
  bedrock?: string
}

/**
 * Core model definitions with provider-specific IDs
 */
const MODELS: Record<string, ModelDefinition> = {
  // OpenAI Models
  'gpt-4o': {
    normalizedName: 'gpt-4o',
    openai: 'gpt-4o'
  },
  'gpt-4o-mini': {
    normalizedName: 'gpt-4o-mini',
    openai: 'gpt-4o-mini'
  },
  'gpt-4': {
    normalizedName: 'gpt-4',
    openai: 'gpt-4'
  },
  'gpt-4-turbo': {
    normalizedName: 'gpt-4-turbo',
    openai: 'gpt-4-turbo'
  },
  'gpt-3.5-turbo': {
    normalizedName: 'gpt-3.5-turbo',
    openai: 'gpt-3.5-turbo'
  },

  // Gemini Models (via OpenAI-compatible provider)
  'gemini-3-flash-preview': {
    normalizedName: 'gemini-3-flash-preview',
    openai: 'gemini-3-flash-preview'
  },
  'gemini-3-pro-preview': {
    normalizedName: 'gemini-3-pro-preview',
    openai: 'gemini-3-pro-preview'
  },

  // GLM Models (via OpenAI-compatible provider)
  'zai-glm-4.7': {
    normalizedName: 'zai-glm-4.7',
    openai: 'priv/cb.zai-glm-4.7'
  },

  // Claude Models (available on multiple providers)
  'claude-sonnet-4-6': {
    normalizedName: 'claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
    bedrock: 'global.anthropic.claude-sonnet-4-6'
  },
  'claude-sonnet-4-5': {
    normalizedName: 'claude-sonnet-4-5',
    anthropic: 'claude-sonnet-4-5-20250929',
    bedrock: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0'
  },
  'claude-haiku-4-5': {
    normalizedName: 'claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5-20251001',
    bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
  },
  'claude-sonnet-4': {
    normalizedName: 'claude-sonnet-4',
    anthropic: 'claude-sonnet-4',
    bedrock: 'global.anthropic.claude-sonnet-4-20250514-v1:0'
  },
  'claude-3-5-sonnet': {
    normalizedName: 'claude-3-5-sonnet',
    anthropic: 'claude-3-5-sonnet',
    bedrock: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0'
  },
  'claude-3-5-haiku': {
    normalizedName: 'claude-3-5-haiku',
    anthropic: 'claude-3-5-haiku',
    bedrock: 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
  },
  'claude-3-sonnet': {
    normalizedName: 'claude-3-sonnet',
    anthropic: 'claude-3-sonnet'
  },
  'claude-3-haiku': {
    normalizedName: 'claude-3-haiku',
    anthropic: 'claude-3-haiku'
  },
  'claude-3-opus': {
    normalizedName: 'claude-3-opus',
    anthropic: 'claude-3-opus'
  }
}

/**
 * Alias mapping - maps all possible aliases to their canonical model key
 */
const ALIASES: Record<string, string> = {
  // OpenAI aliases
  'gpt4o': 'gpt-4o',
  'gpt4o-mini': 'gpt-4o-mini',
  'gpt4': 'gpt-4',
  'gpt35': 'gpt-3.5-turbo',
  'gpt-35-turbo': 'gpt-3.5-turbo',

  // Gemini aliases
  'gemini3-flash': 'gemini-3-flash-preview',
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini3-pro': 'gemini-3-pro-preview',
  'gemini-3-pro': 'gemini-3-pro-preview',

  // GLM aliases
  'priv/cb.zai-glm-4.7': 'zai-glm-4.7',
  'glm-4.7': 'zai-glm-4.7',
  'glm4.7': 'zai-glm-4.7',

  // Claude aliases
  'claude4': 'claude-sonnet-4',
  'sonnet4': 'claude-sonnet-4',
  'claude-sonnet-4-20250514': 'claude-sonnet-4',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
  'claude-3.5-sonnet': 'claude-3-5-sonnet',
  'claude35-sonnet': 'claude-3-5-sonnet',
  'sonnet': 'claude-sonnet-4-5',
  'claude-haiku': 'claude-3-5-haiku',
  'haiku': 'claude-haiku-4-5',
  'claude3-haiku': 'claude-3-haiku'
}

/**
 * Normalize model name and determine provider information
 */
export function normalizeModelName(
  modelName: string, 
  preferBedrock: boolean = false
): ModelInfo {
  const trimmed = modelName.trim()
  const lower = trimmed.toLowerCase()
  
  // Handle full Bedrock ARN-style names first (they take precedence)
  if (lower.includes('anthropic.claude') || lower.includes('global.anthropic')) {
    // Find model by matching Bedrock ARN
    for (const [, model] of Object.entries(MODELS)) {
      if (model.bedrock && lower.includes(model.bedrock.toLowerCase())) {
        return {
          normalizedName: model.normalizedName,
          fullModelId: model.bedrock,
          provider: 'bedrock-claude',
          isSupported: true,
          originalName: modelName
        }
      }
    }
  }
  
  // Resolve alias to canonical model key
  const canonicalKey = ALIASES[lower] || lower
  const model = MODELS[canonicalKey]
  
  if (!model) {
    // Default fallback for unrecognized models
    return {
      normalizedName: trimmed,
      fullModelId: trimmed,
      provider: 'openai', // Default provider
      isSupported: false,
      originalName: modelName
    }
  }
  
  // Determine provider and full model ID based on availability and preference
  if (preferBedrock && model.bedrock) {
    return {
      normalizedName: model.normalizedName,
      fullModelId: model.bedrock,
      provider: 'bedrock-claude',
      isSupported: true,
      originalName: modelName
    }
  } else if (model.anthropic) {
    return {
      normalizedName: model.normalizedName,
      fullModelId: model.anthropic,
      provider: 'anthropic',
      isSupported: true,
      originalName: modelName
    }
  } else if (model.openai) {
    return {
      normalizedName: model.normalizedName,
      fullModelId: model.openai,
      provider: 'openai',
      isSupported: true,
      originalName: modelName
    }
  }
  
  // Should not reach here but fallback just in case
  return {
    normalizedName: model.normalizedName,
    fullModelId: model.normalizedName,
    provider: 'openai',
    isSupported: true,
    originalName: modelName
  }
}

/**
 * Get all available model short names
 */
export function getAvailableModels(): string[] {
  // Return both canonical model names and aliases
  const allNames = [...Object.keys(MODELS), ...Object.keys(ALIASES)]
  return [...new Set(allNames)].sort()
}

/**
 * Check if a model name is supported
 */
export function isModelSupported(modelName: string): boolean {
  if (!modelName || typeof modelName !== 'string') {
    return false
  }
  
  const lower = modelName.toLowerCase().trim()
  if (lower === '') {
    return false
  }
  
  const canonicalKey = ALIASES[lower] || lower
  return canonicalKey in MODELS || lower.includes('anthropic.claude')
}

/**
 * Get the full model identifier from a short name
 */
export function getFullModelName(shortName: string, preferBedrock: boolean = false): string {
  const info = normalizeModelName(shortName, preferBedrock)
  return info.fullModelId
}

/**
 * Get the canonical normalized name for a model
 */
export function getNormalizedModelName(modelName: string): string {
  const info = normalizeModelName(modelName)
  return info.normalizedName
}

/**
 * Get the provider for a given model name  
 */
export function getModelProvider(modelName: string, preferBedrock: boolean = false): ModelProvider {
  const info = normalizeModelName(modelName, preferBedrock)
  return info.provider
}

/**
 * Check if a model supports caching (Bedrock Claude models only)
 */
export function modelSupportsCaching(modelName: string): boolean {
  const info = normalizeModelName(modelName, true) // Prefer Bedrock for caching check
  return info.provider === 'bedrock-claude'
}

/**
 * Get model information with detailed metadata
 */
export function getModelInfo(
  modelName: string, 
  preferBedrock: boolean = false
): ModelInfo {
  return normalizeModelName(modelName, preferBedrock)
}

/**
 * Legacy compatibility: Get model mappings for unified-provider.ts
 */
export function getLegacyModelMappings(): Record<string, string> {
  const mappings: Record<string, string> = {}
  
  // Add canonical model names with their primary provider ID
  for (const [key, model] of Object.entries(MODELS)) {
    // Prefer Bedrock for Claude models, otherwise use first available provider
    if (model.bedrock) {
      mappings[key] = model.bedrock
    } else if (model.anthropic) {
      mappings[key] = model.anthropic
    } else if (model.openai) {
      mappings[key] = model.openai
    }
  }
  
  // Add all aliases with their resolved provider ID
  for (const [alias, canonicalKey] of Object.entries(ALIASES)) {
    const model = MODELS[canonicalKey]
    if (model) {
      // Prefer Bedrock for Claude models, otherwise use first available provider
      if (model.bedrock) {
        mappings[alias] = model.bedrock
      } else if (model.anthropic) {
        mappings[alias] = model.anthropic
      } else if (model.openai) {
        mappings[alias] = model.openai
      }
    }
  }
  
  return mappings
}

const EFFORT_SUPPORTED_MODELS = new Set([
  'claude-sonnet-4-6',
])

/**
 * Check if a model supports the Anthropic `effort` parameter.
 */
export function supportsEffort(modelName: string): boolean {
  const { normalizedName } = normalizeModelName(modelName)
  return EFFORT_SUPPORTED_MODELS.has(normalizedName)
}

/**
 * Export model definitions for advanced usage
 */
export { MODELS, ALIASES }

/**
 * Legacy export for Bedrock model constants (for backward compatibility)
 */
export const BEDROCK_MODELS = {
  sonnet45: MODELS['claude-sonnet-4-5']?.bedrock || 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
  haiku45: MODELS['claude-haiku-4-5']?.bedrock || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  claude4: MODELS['claude-sonnet-4']?.bedrock || 'global.anthropic.claude-sonnet-4-20250514-v1:0',
  claude35: MODELS['claude-3-5-sonnet']?.bedrock || 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
  claude3haiku: MODELS['claude-3-5-haiku']?.bedrock || 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
} as const
