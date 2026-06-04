/**
 * Unified Model Name Normalization System
 *
 * Centralizes all model name normalization logic to ensure consistency
 * across providers, token counting, and pricing calculations.
 */

/**
 * Supported model providers
 */
export type ModelProvider = 'openai' | 'anthropic'

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

export type ModelProviderOptions = Record<string, unknown>

export interface ModelDefaultSettings {
  providerOptions?: ModelProviderOptions
  temperature?: number
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
  /** Provider-specific default options for this model */
  providerOptions?: ModelProviderOptions
  /** Model-level default temperature */
  temperature?: number
  /**
   * When true, the caller-provided `temperature` is stripped from outgoing
   * requests. If `temperature` (above) is also set, that model default is
   * applied via defaultSettingsMiddleware after stripping; otherwise the
   * field is genuinely omitted.
   */
  stripTemperature?: boolean
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

  // Kimi Models (via OpenAI-compatible provider)
  'azure/kimi-k2.6': {
    normalizedName: 'azure/kimi-k2.6',
    openai: 'azure/Kimi-K2.6',
    stripTemperature: true,
    temperature: 0.6,
    providerOptions: {
      litellm: {
        extra_body: {
          reasoning_effort: 'none',
        },
        metadata: {
          guardrails: {
            'unicode-security': {
              extra_body: {
                mode: 'disabled',
              },
            },
          },
        },
      },
    },
  },
  'azure/kimi-k2.6-thinking': {
    normalizedName: 'azure/kimi-k2.6',
    openai: 'azure/Kimi-K2.6',
    stripTemperature: true,
    temperature: 1.0,
    providerOptions: {
      litellm: {
        extra_body: {
          reasoning_effort: 'low',
        },
        metadata: {
          guardrails: {
            'unicode-security': {
              extra_body: {
                mode: 'disabled',
              },
            },
          },
        },
      },
    },
  },

  // Claude Models (available on multiple providers)
  'claude-opus-4-7': {
    normalizedName: 'claude-opus-4-7',
    anthropic: 'claude-opus-4-7',
    stripTemperature: true,
    providerOptions: {
      anthropic: {
        effort: 'low',
      },
    },
  },
  'claude-opus-4-6': {
    normalizedName: 'claude-opus-4-6',
    anthropic: 'claude-opus-4-6',
    providerOptions: {
      anthropic: {
        effort: 'low',
      },
    },
  },
  'claude-sonnet-4-6': {
    normalizedName: 'claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
    providerOptions: {
      anthropic: {
        effort: 'low',
      },
    },
  },
  'azure/claude-sonnet-4-6': {
    normalizedName: 'claude-sonnet-4-6',
    anthropic: 'azure/claude-sonnet-4-6',
    providerOptions: {
      anthropic: {
        effort: 'low',
      },
    },
  },
  'claude-sonnet-4-5': {
    normalizedName: 'claude-sonnet-4-5',
    anthropic: 'claude-sonnet-4-5-20250929'
  },
  'claude-haiku-4-5': {
    normalizedName: 'claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5-20251001'
  },
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
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
  'sonnet': 'claude-sonnet-4-6',
  'haiku': 'claude-haiku-4-5'
}

/**
 * Normalize model name and determine provider information
 */
export function normalizeModelName(
  modelName: string
): ModelInfo {
  const trimmed = modelName.trim()
  const lower = trimmed.toLowerCase()

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

  // Determine provider and full model ID based on availability
  if (model.anthropic) {
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
  return canonicalKey in MODELS
}

/**
 * Get the full model identifier from a short name
 */
export function getFullModelName(shortName: string): string {
  const info = normalizeModelName(shortName)
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
 * Resolve a model name to its canonical key — the `MODELS` map key it indexes,
 * obtained by trimming, lowercasing, and following the alias table. Names with
 * no `MODELS`/`ALIASES` entry resolve to their own normalized string.
 *
 * This is the right key for deduplicating the override allowlist: known aliases
 * of the same configured model collapse to one key (e.g. `sonnet` and
 * `claude-sonnet-4-6`), while distinct `MODELS` entries stay distinct even when
 * they share a `normalizedName` and/or an upstream id — e.g. `azure/claude-sonnet-4-6`
 * vs `claude-sonnet-4-6` (same `normalizedName`), or `azure/kimi-k2.6` vs
 * `azure/kimi-k2.6-thinking` (same `normalizedName` AND same upstream id). In those
 * cases `getNormalizedModelName` or `fullName` would wrongly merge them.
 */
export function getCanonicalModelKey(modelName: string): string {
  const lower = modelName.trim().toLowerCase()
  return ALIASES[lower] || lower
}

/**
 * Get the provider for a given model name
 */
export function getModelProvider(modelName: string): ModelProvider {
  const info = normalizeModelName(modelName)
  return info.provider
}

/**
 * Get model information with detailed metadata
 */
export function getModelInfo(
  modelName: string
): ModelInfo {
  return normalizeModelName(modelName)
}

/**
 * Legacy compatibility: Get model mappings for unified-provider.ts
 */
export function getLegacyModelMappings(): Record<string, string> {
  const mappings: Record<string, string> = {}

  // Add canonical model names with their primary provider ID
  for (const [key, model] of Object.entries(MODELS)) {
    if (model.anthropic) {
      mappings[key] = model.anthropic
    } else if (model.openai) {
      mappings[key] = model.openai
    }
  }

  // Add all aliases with their resolved provider ID
  for (const [alias, canonicalKey] of Object.entries(ALIASES)) {
    const model = MODELS[canonicalKey]
    if (model) {
      if (model.anthropic) {
        mappings[alias] = model.anthropic
      } else if (model.openai) {
        mappings[alias] = model.openai
      }
    }
  }

  return mappings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function mergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(base)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      continue
    }

    merged[key] = isRecord(value)
      ? mergeRecords({}, value)
      : value
  }

  for (const [key, value] of Object.entries(override)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      continue
    }

    const existing = merged[key]
    merged[key] = isRecord(value)
      ? mergeRecords(isRecord(existing) ? existing : {}, value)
      : value
  }

  return merged
}

/**
 * Deep merge provider options. Empty objects are treated the same as omitted options.
 */
export function mergeProviderOptions(
  ...providerOptions: Array<ModelProviderOptions | undefined>
): ModelProviderOptions | undefined {
  let merged: ModelProviderOptions = {}

  for (const options of providerOptions) {
    if (options && Object.keys(options).length > 0) {
      merged = mergeRecords(merged, options)
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export function getDefaultProviderOptions(modelName: string): ModelProviderOptions | undefined {
  const lower = modelName.toLowerCase().trim()
  const canonicalKey = ALIASES[lower] || lower
  return MODELS[canonicalKey]?.providerOptions
}

export function getDefaultModelSettings(modelName: string): ModelDefaultSettings | undefined {
  const lower = modelName.toLowerCase().trim()
  const canonicalKey = ALIASES[lower] || lower
  const model = MODELS[canonicalKey]
  if (!model) {
    return undefined
  }

  const settings: ModelDefaultSettings = {}
  if (model.providerOptions) {
    settings.providerOptions = model.providerOptions
  }
  if (model.temperature !== undefined) {
    settings.temperature = model.temperature
  }

  return Object.keys(settings).length > 0 ? settings : undefined
}

export function shouldStripTemperature(modelName: string): boolean {
  const lower = modelName.toLowerCase().trim()
  const canonicalKey = ALIASES[lower] || lower
  return MODELS[canonicalKey]?.stripTemperature === true
}

/**
 * Export model definitions for advanced usage
 */
export { MODELS, ALIASES }
