/**
 * Model Context Window Utilities
 *
 * Provides context window size information for different AI models.
 * Context windows define the maximum number of tokens (input + output)
 * that a model can process in a single request.
 */

/**
 * Known context window sizes for different models
 *
 * Source: Official model documentation
 * - Claude: https://docs.anthropic.com/claude/docs/models-overview
 * - OpenAI: https://platform.openai.com/docs/models
 */
const MODEL_CONTEXT_WINDOWS = {
  // Claude models (Anthropic)
  'claude-opus-4-7': 200000,
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-5': 200000,

  // OpenAI models
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,

  // Short names (used by getModel in ai-lib)
  'sonnet': 200000,  // Claude Sonnet (latest)
  'opus': 200000,    // Claude Opus (latest)
  'haiku': 200000,   // Claude Haiku (latest)

  // Default fallback for unknown models
  'default': 128000
} as const satisfies Record<string, number>

/**
 * Get the context window size for a given model
 *
 * @param modelName - The model identifier (e.g., 'claude-sonnet-4-5', 'gpt-4o', 'sonnet')
 * @returns The context window size in tokens
 *
 * @example
 * ```typescript
 * const windowSize = getModelContextWindow('claude-sonnet-4-5')
 * // Returns: 200000
 *
 * const windowSize = getModelContextWindow('gpt-4o')
 * // Returns: 128000
 *
 * const windowSize = getModelContextWindow('unknown-model')
 * // Returns: 128000 (default)
 * ```
 */
export function getModelContextWindow(modelName: string | undefined): number {
  if (!modelName) {
    return MODEL_CONTEXT_WINDOWS.default
  }

  // Normalize model name to lowercase for case-insensitive matching
  const normalizedName = modelName.toLowerCase().trim()

  // Exact match
  if (normalizedName in MODEL_CONTEXT_WINDOWS) {
    const windowSize = MODEL_CONTEXT_WINDOWS[normalizedName as keyof typeof MODEL_CONTEXT_WINDOWS]
    return windowSize
  }

  // Partial match - check if model name contains known identifiers
  // This handles cases like 'anthropic.claude-sonnet-4-5-v2:0' (Bedrock format)
  // Order matters: check more specific patterns first to avoid misclassification
  // e.g., 'gpt-4o' before 'gpt-4' to avoid matching 'gpt-4o-mini' as 8k
  const orderedKeys = [
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
    'gpt-4',
    'sonnet',
    'opus',
    'haiku'
  ]

  for (const key of orderedKeys) {
    if (normalizedName.includes(key)) {
      return MODEL_CONTEXT_WINDOWS[key as keyof typeof MODEL_CONTEXT_WINDOWS]
    }
  }

  // Return default for unknown models
  return MODEL_CONTEXT_WINDOWS.default
}

/**
 * Calculate cache metrics for token usage
 *
 * @param inputTokens - Total input tokens (cached + fresh)
 * @param cachedInputTokens - Cached input tokens (may be undefined/null)
 * @returns Object with calculated cache metrics
 *
 * @example
 * ```typescript
 * const metrics = calculateCacheMetrics(10000, 7000)
 * // Returns: { cachedTokens: 7000, freshTokens: 3000, cacheHitRate: 70 }
 *
 * const metrics = calculateCacheMetrics(10000, undefined)
 * // Returns: { cachedTokens: 0, freshTokens: 10000, cacheHitRate: 0 }
 *
 * const metrics = calculateCacheMetrics(0, 0)
 * // Returns: { cachedTokens: 0, freshTokens: 0, cacheHitRate: 0 }
 *
 * const metrics = calculateCacheMetrics(10000, 12000)
 * // Returns: { cachedTokens: 10000, freshTokens: 0, cacheHitRate: 100 }
 * // (Clamps to prevent negative freshTokens from provider bugs)
 * ```
 */
export function calculateCacheMetrics(
  inputTokens: number,
  cachedInputTokens: number | undefined | null
): {
  cachedTokens: number
  freshTokens: number
  cacheHitRate: number
} {
  // Clamp cachedTokens to [0, inputTokens] to handle provider accounting bugs
  // where cachedInputTokens might exceed inputTokens
  const rawCachedTokens = cachedInputTokens || 0
  const cachedTokens = Math.max(0, Math.min(rawCachedTokens, inputTokens))
  const freshTokens = inputTokens - cachedTokens

  // Clamp cache hit rate to [0, 100] to ensure valid percentage
  const rawCacheHitRate = inputTokens > 0
    ? Math.round((cachedTokens / inputTokens) * 100)
    : 0
  const cacheHitRate = Math.max(0, Math.min(rawCacheHitRate, 100))

  return {
    cachedTokens,
    freshTokens,
    cacheHitRate
  }
}

/**
 * Calculate context window utilization percentage
 *
 * @param inputTokens - Number of input tokens used
 * @param modelName - The model identifier
 * @returns Utilization percentage (0-100, rounded to nearest integer)
 *
 * @example
 * ```typescript
 * const utilization = calculateContextWindowUtilization(40000, 'claude-sonnet-4-5')
 * // Returns: 20 (40k / 200k = 20%)
 *
 * const utilization = calculateContextWindowUtilization(64000, 'gpt-4o')
 * // Returns: 50 (64k / 128k = 50%)
 *
 * const utilization = calculateContextWindowUtilization(0, 'claude-sonnet-4-5')
 * // Returns: 0
 * ```
 */
export function calculateContextWindowUtilization(
  inputTokens: number,
  modelName: string | undefined
): number {
  const contextWindowSize = getModelContextWindow(modelName)

  if (contextWindowSize === 0) {
    return 0
  }

  return Math.round((inputTokens / contextWindowSize) * 100)
}
