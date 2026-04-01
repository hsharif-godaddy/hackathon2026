/**
 * Dynamic Prompt Caching Utility
 *
 * Automatically applies caching to appropriate messages based on provider and message position.
 * Reduces API costs by caching conversation prefixes that get resent repeatedly.
 *
 * Based on Vercel AI SDK pattern: https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching
 */

import type { ModelMessage, LanguageModel, SystemModelMessage } from 'ai'
import { createLogger } from '@airo/ai-common'

const logger = createLogger('prompt-caching')

/**
 * Provider-specific caching configuration
 */
export interface CachingProviderOptions {
  /** Anthropic uses 'ephemeral' for 5-minute cache */
  anthropic?: { cacheControl: { type: 'ephemeral' } }
}

/**
 * Caching strategy configuration
 */
export interface CachingStrategy {
  /** Reserve a breakpoint slot for the system prompt (set via addCacheControlToSystemPrompt).
   *  When true, remainingSlots is reduced by 1 to avoid exceeding Anthropic's 4-breakpoint limit.
   *  Callers using addCacheControlToSystemPrompt externally MUST keep this true. */
  cacheSystemPrompts?: boolean
  /** Maximum NEW breakpoints this function may add (Anthropic total limit: 4, default: 3) */
  maxBreakpoints?: number
  /** Provider-specific options */
  providerOptions?: CachingProviderOptions
}

/**
 * Default caching strategy
 * Budget: 4 total (Anthropic limit) = 1 system (reserved) + 1 memory (pre-set) + up to 2 new here
 * maxBreakpoints: 3 caps new breakpoints, but remainingSlots (4 - existing - system) usually yields 2
 */
const DEFAULT_STRATEGY: Required<CachingStrategy> = {
  cacheSystemPrompts: true,
  maxBreakpoints: 3, // Cap for this function; effective limit is min(3, remainingSlots)
  providerOptions: {
    anthropic: { cacheControl: { type: 'ephemeral' } }
  }
}

/**
 * Detect if model supports prompt caching
 * Currently supports Anthropic models
 */
export function supportsPromptCaching(model: LanguageModel): boolean {
  // Handle string model IDs (valid per AI SDK)
  if (typeof model === 'string') {
    const modelStr = model.toLowerCase()
    return modelStr.includes('claude') ||
           modelStr.includes('anthropic')
  }

  // Handle model objects
  const modelAny = model as any
  const modelId = (modelAny.modelId || '').toLowerCase()
  const provider = (modelAny.provider || '').toLowerCase()

  // Anthropic models
  const isAnthropic = provider.includes('anthropic') ||
                      modelId.includes('claude') ||
                      modelId.includes('anthropic')

  return isAnthropic
}

/**
 * Add cache control to conversation messages dynamically
 *
 * Strategy (per Anthropic docs and Vercel AI SDK cookbook):
 * 1. Place breakpoint on the LAST message (highest priority - caches full prefix)
 * 2. Place an intermediate "stepping stone" breakpoint within the lookback window
 *    of the nearest existing breakpoint (e.g., memory summary) to bridge long gaps
 * 3. Each subsequent request extends the cache by moving breakpoints forward
 *
 * System prompt caching is handled separately by addCacheControlToSystemPrompt().
 *
 * IMPORTANT: Anthropic has a hard limit of 4 cache breakpoints per request.
 * Typical budget: 1 system (external) + 1 memory summary (pre-set) + 2 here = 4.
 * When existing breakpoints consume slots, this function adds fewer breakpoints.
 *
 * NOTE: With only 4 breakpoints total, gaps >20 blocks between the intermediate
 * and last-message breakpoints are expected in long conversations (200+ blocks).
 * This is an accepted limitation - additional intermediates would require more slots.
 *
 * @param messages - Array of messages to process (should NOT include the new user message)
 * @param model - Language model (used to detect provider)
 * @param strategy - Caching strategy configuration
 * @returns Messages with caching metadata applied
 */
export function addCacheControlToMessages(
  messages: ModelMessage[],
  model: LanguageModel,
  strategy: CachingStrategy = {}
): ModelMessage[] {
  // Merge with defaults
  const config = { ...DEFAULT_STRATEGY, ...strategy }

  // Check if model supports caching
  if (!supportsPromptCaching(model)) {
    const modelAny = typeof model === 'object' ? model as any : null
    logger.debug('prompt_caching.skip.unsupported_provider', {
      provider: modelAny?.provider || 'unknown',
      modelId: modelAny?.modelId || (typeof model === 'string' ? model : 'unknown')
    })
    return messages
  }

  const cacheControl = config.providerOptions.anthropic?.cacheControl ||
                       { type: 'ephemeral' as const }

  // Count existing cache breakpoints already set on messages (e.g., from
  // ConversationHistoryLoader summaries or context attachments). These count
  // toward Anthropic's hard limit of 4 breakpoints per request. The system
  // prompt breakpoint (set via addCacheControlToSystemPrompt) also counts as 1.
  //
  // NOTE: This only checks providerOptions.anthropic.cacheControl. Pipeline messages
  // using cachePoint (e.g., memory summary in context-manager.ts) are converted to
  // providerOptions by normalizeContextMessages() BEFORE reaching this function.
  const existingBreakpoints = messages.filter(msg => {
    const providerOptions = (msg as any).providerOptions
    return !!(providerOptions?.anthropic?.cacheControl)
  }).length

  // Reserve 1 for the system prompt breakpoint set via addCacheControlToSystemPrompt
  const ANTHROPIC_MAX_BREAKPOINTS = 4
  const systemPromptBreakpoints = config.cacheSystemPrompts ? 1 : 0
  const remainingSlots = ANTHROPIC_MAX_BREAKPOINTS - existingBreakpoints - systemPromptBreakpoints

  if (remainingSlots <= 0) {
    logger.debug('prompt_caching.skip.breakpoint_limit', {
      existingBreakpoints,
      systemPromptBreakpoints,
      maxAllowed: ANTHROPIC_MAX_BREAKPOINTS
    })
    return messages
  }

  // Identify breakpoint positions (limited by remaining slots)
  const breakpoints: number[] = []

  // Anthropic's cache lookback walks at most 20 blocks backward from each breakpoint.
  // With long conversation histories (90+ messages), the gap between existing breakpoints
  // (e.g., memory summary at position ~3) and the last message can far exceed 20 blocks,
  // causing cache misses. We place intermediate "stepping stone" breakpoints so each
  // lookback window can chain to the previous cached entry.
  const LOOKBACK_WINDOW = 20

  // Find the position of the last existing breakpoint (e.g., memory summary's ephemeral
  // cache point). We'll place our intermediate breakpoint within LOOKBACK_WINDOW of it.
  let lastExistingBreakpointIndex = -1
  messages.forEach((msg, index) => {
    const providerOptions = (msg as any).providerOptions
    if (providerOptions?.anthropic?.cacheControl) {
      lastExistingBreakpointIndex = index
    }
  })

  logger.debug('prompt_caching.breakpoint_analysis', {
    totalMessages: messages.length,
    existingBreakpoints,
    lastExistingBreakpointIndex,
    remainingSlots
  })

  // Priority ordering: last-message first, intermediate second. When only 1 slot
  // remains, slice(0, maxNewBreakpoints) keeps the last-message breakpoint and
  // drops the intermediate, since caching the full prefix is more valuable.
  // Skip if already cached (e.g., within-turn retry) to avoid wasting a slot.
  const lastMessageIndex = messages.length - 1
  const lastMsgProviderOptions = (messages[lastMessageIndex] as any)?.providerOptions
  if (lastMessageIndex >= 0 && !lastMsgProviderOptions?.anthropic?.cacheControl) {
    breakpoints.push(lastMessageIndex)
  }

  // Place an intermediate breakpoint if the gap between the anchor point and the last
  // message exceeds the lookback window. The anchor is the last existing breakpoint
  // (e.g., memory summary) or position 0 if none exists (unsummarized conversations).
  //
  // IMPORTANT: Anthropic's lookback counts content BLOCKS, not messages. A message with
  // array content (e.g., text + 3 tool calls) counts as multiple blocks. We count blocks
  // from the anchor forward to find the right message index for the intermediate.
  const anchorIndex = lastExistingBreakpointIndex >= 0 ? lastExistingBreakpointIndex : 0
  if (lastMessageIndex - anchorIndex > 1) {
    // Count content blocks from anchor to find where the lookback window ends
    const MAX_BLOCKS = LOOKBACK_WINDOW - 2 // Leave 2-block margin for safety
    let blockCount = 0
    let intermediateIndex = -1
    for (let i = anchorIndex + 1; i < lastMessageIndex; i++) {
      const content = messages[i]?.content
      blockCount += Array.isArray(content) ? content.length : 1
      if (blockCount >= MAX_BLOCKS) {
        intermediateIndex = i
        break
      }
    }

    if (intermediateIndex > anchorIndex && !breakpoints.includes(intermediateIndex)) {
      breakpoints.push(intermediateIndex)
    }
  }

  // Enforce remaining slots (respect both configured maxBreakpoints and Anthropic's limit)
  const maxNewBreakpoints = Math.min(config.maxBreakpoints, remainingSlots)
  const finalBreakpoints = breakpoints.slice(0, maxNewBreakpoints)

  // Apply cache control to messages at breakpoints
  const enhancedMessages = messages.map((msg, index) => {
    if (!finalBreakpoints.includes(index)) {
      return msg
    }

    // Check if message already has caching configured
    const existingProviderOptions = (msg as any).providerOptions
    if (existingProviderOptions?.anthropic?.cacheControl) {
      logger.debug('prompt_caching.skip.already_cached', {
        index,
        role: msg.role
      })
      return msg
    }

    logger.debug('prompt_caching.apply', {
      index,
      role: msg.role,
      breakpointPosition: finalBreakpoints.indexOf(index) + 1,
      totalBreakpoints: finalBreakpoints.length,
      cacheType: cacheControl.type,
      messageLength: typeof msg.content === 'string'
        ? msg.content.length
        : JSON.stringify(msg.content).length
    })

    return {
      ...msg,
      providerOptions: {
        ...(existingProviderOptions || {}),
        // Anthropic direct format
        anthropic: {
          ...(existingProviderOptions?.anthropic || {}),
          cacheControl
        }
      }
    }
  })

  const modelAny = typeof model === 'object' ? model as any : null
  logger.info('prompt_caching.complete', {
    totalMessages: messages.length,
    breakpointCount: finalBreakpoints.length,
    breakpointPositions: finalBreakpoints,
    maxBreakpointsAllowed: config.maxBreakpoints,
    provider: modelAny?.provider || 'unknown',
    modelId: modelAny?.modelId || (typeof model === 'string' ? model : 'unknown')
  })

  return enhancedMessages
}

/**
 * Estimate potential cost savings from caching
 *
 * Claude Sonnet 4.5 pricing (Standard Context ≤ 200K tokens):
 * - Input tokens: $3.00 per million tokens
 * - Cached input tokens: $0.30 per million tokens (90% savings)
 * - Cache writes: $3.75 per million tokens (25% premium)
 *
 * Extended Context (> 200K tokens) has different pricing but is not common
 * for typical agent conversations.
 *
 * @param totalInputTokens - Total input tokens in request
 * @param cachedInputTokens - Tokens served from cache
 * @param cacheWriteTokens - Tokens written to cache
 * @returns Estimated cost and savings in USD
 */
export function estimateCachingSavings(
  totalInputTokens: number,
  cachedInputTokens: number,
  cacheWriteTokens: number
): {
  costWithoutCaching: number
  costWithCaching: number
  savings: number
  savingsPercentage: number
} {
  // Claude Sonnet 4.5 pricing (Standard Context, per million tokens)
  // Source: https://claude.com/pricing (as of January 2026)
  const INPUT_PRICE = 3.00
  const CACHED_INPUT_PRICE = 0.30
  const CACHE_WRITE_PRICE = 3.75

  // Cost without caching
  const costWithoutCaching = (totalInputTokens / 1_000_000) * INPUT_PRICE

  // Cost with caching — uncached tokens exclude both cache reads and writes
  const uncachedTokens = Math.max(0, totalInputTokens - cachedInputTokens - cacheWriteTokens)
  const costWithCaching =
    (uncachedTokens / 1_000_000) * INPUT_PRICE +
    (cachedInputTokens / 1_000_000) * CACHED_INPUT_PRICE +
    (cacheWriteTokens / 1_000_000) * CACHE_WRITE_PRICE

  const savings = costWithoutCaching - costWithCaching
  const savingsPercentage = costWithoutCaching > 0
    ? (savings / costWithoutCaching) * 100
    : 0

  return {
    costWithoutCaching,
    costWithCaching,
    savings,
    savingsPercentage
  }
}

/**
 * Add cache control to system prompt/instructions
 *
 * Converts string system prompts to SystemModelMessage with providerOptions
 * or adds providerOptions to existing SystemModelMessage arrays.
 *
 * @param systemPrompt - System prompt (string or SystemModelMessage[])
 * @param model - Language model (used to detect provider)
 * @param strategy - Caching strategy configuration
 * @returns System prompt with caching metadata in providerOptions
 */
export function addCacheControlToSystemPrompt(
  systemPrompt: string | SystemModelMessage | SystemModelMessage[],
  model: LanguageModel,
  strategy: CachingStrategy = {}
): string | SystemModelMessage | SystemModelMessage[] {
  // Merge with defaults
  const config = { ...DEFAULT_STRATEGY, ...strategy }

  // Check if model supports caching
  if (!supportsPromptCaching(model)) {
    return systemPrompt
  }

  // Check if system prompt caching is enabled
  if (!config.cacheSystemPrompts) {
    return systemPrompt
  }

  const cacheControl = config.providerOptions.anthropic?.cacheControl ||
                       { type: 'ephemeral' as const }

  // Handle string system prompt - convert to SystemModelMessage with providerOptions
  if (typeof systemPrompt === 'string') {
    logger.debug('prompt_caching.system.apply', {
      type: 'string',
      length: systemPrompt.length,
      cacheType: cacheControl.type
    })

    return {
      role: 'system' as const,
      content: systemPrompt,
      providerOptions: {
        // Anthropic direct format
        anthropic: {
          cacheControl
        }
      }
    }
  }

  // Handle single SystemModelMessage
  if (!Array.isArray(systemPrompt) && typeof systemPrompt === 'object' && systemPrompt.role === 'system') {
    logger.debug('prompt_caching.system.apply', {
      type: 'SystemModelMessage',
      length: systemPrompt.content.length,
      cacheType: cacheControl.type
    })

    return {
      ...systemPrompt,
      providerOptions: {
        ...(systemPrompt.providerOptions || {}),
        anthropic: {
          ...(systemPrompt.providerOptions?.anthropic as Record<string, unknown> || {}),
          cacheControl
        }
      }
    }
  }

  // Handle array of SystemModelMessage - add providerOptions to last message
  if (Array.isArray(systemPrompt) && systemPrompt.length > 0) {
    const lastIndex = systemPrompt.length - 1
    const enhancedMessages = systemPrompt.map((msg, index) => {
      if (index === lastIndex) {
        logger.debug('prompt_caching.system.apply', {
          type: 'SystemModelMessage[]',
          messageCount: systemPrompt.length,
          lastMessageIndex: lastIndex,
          cacheType: cacheControl.type
        })

        return {
          ...msg,
          providerOptions: {
            ...(msg.providerOptions || {}),
            anthropic: {
              ...(msg.providerOptions?.anthropic as Record<string, unknown> || {}),
              cacheControl
            }
          }
        }
      }
      return msg
    })

    return enhancedMessages
  }

  return systemPrompt
}

/**
 * Log caching statistics for monitoring
 *
 * IMPORTANT: Anthropic's usage metrics (AI SDK v6 field names):
 * - inputTokens: Total input tokens (includes cached)
 * - inputTokenDetails.cacheReadTokens: Tokens read from cache (cache hit)
 * - inputTokenDetails.cacheWriteTokens: Tokens written to cache (cache miss)
 * - inputTokenDetails.noCacheTokens: Tokens after last breakpoint (never cached)
 *
 * Also accepts deprecated cachedInputTokens for backward compatibility.
 */
export function logCachingStats(usage: {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number | undefined
  inputTokenDetails?: {
    cacheReadTokens?: number | undefined
    cacheWriteTokens?: number | undefined
    noCacheTokens?: number | undefined
  }
}): void {
  const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0
  const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0

  if (cacheReadTokens === 0 && cacheWriteTokens === 0) {
    return
  }

  const totalInputTokens = usage.inputTokens
  const cacheHitRate = totalInputTokens > 0
    ? (cacheReadTokens / totalInputTokens) * 100
    : 0

  const savings = estimateCachingSavings(
    totalInputTokens,
    cacheReadTokens,
    cacheWriteTokens
  )

  logger.info('prompt_caching.stats', {
    noCacheTokens: usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, totalInputTokens - cacheReadTokens - cacheWriteTokens),
    cacheReadTokens,
    cacheWriteTokens,
    totalInputTokens,
    cacheHitRate: `${cacheHitRate.toFixed(1)}%`,
    estimatedSavings: `$${savings.savings.toFixed(4)}`,
    savingsPercentage: `${savings.savingsPercentage.toFixed(1)}%`
  })
}
