/**
 * Dynamic Prompt Caching Utility
 *
 * Automatically applies caching to appropriate messages based on provider and message position.
 * Reduces API costs by caching conversation prefixes that get resent repeatedly.
 *
 * Based on Vercel AI SDK pattern: https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching
 */

import type { ModelMessage, LanguageModel, SystemModelMessage } from 'ai'
import { createLogger } from './logger.js'

const logger = createLogger('prompt-caching')

/**
 * Provider-specific caching configuration
 */
export interface CachingProviderOptions {
  /** Anthropic/Bedrock uses 'ephemeral' for 5-minute cache */
  anthropic?: { cacheControl: { type: 'ephemeral' } }
}

/**
 * Caching strategy configuration
 */
export interface CachingStrategy {
  /** Enable caching for system prompts (recommended) */
  cacheSystemPrompts?: boolean
  /** Maximum cache breakpoints to use (Anthropic limit: 4, default: 2) */
  maxBreakpoints?: number
  /** Provider-specific options */
  providerOptions?: CachingProviderOptions
}

/**
 * Default caching strategy
 * Uses conservative 2 breakpoints: system prompt + conversation history
 */
const DEFAULT_STRATEGY: Required<CachingStrategy> = {
  cacheSystemPrompts: true,
  maxBreakpoints: 2, // System + conversation (stay well under Anthropic's limit of 4)
  providerOptions: {
    anthropic: { cacheControl: { type: 'ephemeral' } }
  }
}

/**
 * Detect if model supports prompt caching
 * Currently supports Anthropic models (via direct API or Bedrock)
 */
export function supportsPromptCaching(model: LanguageModel): boolean {
  // Handle string model IDs (valid per AI SDK)
  if (typeof model === 'string') {
    const modelStr = model.toLowerCase()
    return modelStr.includes('claude') ||
           modelStr.includes('anthropic') ||
           (modelStr.includes('bedrock') && modelStr.includes('anthropic'))
  }

  // Handle model objects
  const modelAny = model as any
  const modelId = (modelAny.modelId || '').toLowerCase()
  const provider = (modelAny.provider || '').toLowerCase()

  // Anthropic models directly or via Bedrock
  const isAnthropic = provider.includes('anthropic') ||
                      modelId.includes('claude') ||
                      modelId.includes('anthropic')

  // Bedrock with Anthropic models
  const isBedrockAnthropic = provider.includes('bedrock') && modelId.includes('anthropic')

  return isAnthropic || isBedrockAnthropic
}

/**
 * Add cache control to messages dynamically
 *
 * CORRECT Strategy (per Anthropic docs and Vercel AI SDK cookbook):
 * 1. Place breakpoint on system prompt (if enabled)
 * 2. Place breakpoint on the FINAL message before new user input
 * 3. This caches everything UP TO that final message
 * 4. Each subsequent request extends the cache by moving the breakpoint forward
 *
 * IMPORTANT: Anthropic has a hard limit of 4 cache breakpoints per request.
 * We use at most 2 by default (system + conversation) to stay well under the limit.
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
  const existingBreakpoints = messages.filter(msg => {
    const providerOptions = (msg as any).providerOptions
    return !!(providerOptions?.bedrock?.cachePoint || providerOptions?.anthropic?.cacheControl)
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

  // Breakpoint 1: System prompt (if enabled and exists)
  // Skip if a system message is already explicitly cached.
  if (config.cacheSystemPrompts) {
    const hasCachedSystemMessage = messages.some(msg => {
      if (msg.role !== 'system') {
        return false
      }
      const providerOptions = (msg as any).providerOptions
      return !!(providerOptions?.bedrock?.cachePoint || providerOptions?.anthropic?.cacheControl)
    })

    if (!hasCachedSystemMessage) {
      const systemIndex = messages.findIndex(m => m.role === 'system')
      if (systemIndex >= 0) {
        breakpoints.push(systemIndex)
      }
    }
  }

  // Breakpoint 2: The FINAL message before new input
  // This is the key insight - mark the last message, and everything up to it gets cached
  const lastMessageIndex = messages.length - 1
  if (lastMessageIndex >= 0 && !breakpoints.includes(lastMessageIndex)) {
    breakpoints.push(lastMessageIndex)
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
    if (existingProviderOptions?.bedrock?.cachePoint ||
        existingProviderOptions?.anthropic?.cacheControl) {
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
        // Bedrock format
        bedrock: {
          ...(existingProviderOptions?.bedrock || {}),
          cachePoint: cacheControl.type
        },
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
        // Bedrock format
        bedrock: {
          cachePoint: cacheControl.type
        },
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
        bedrock: {
          ...(systemPrompt.providerOptions?.bedrock as Record<string, unknown> || {}),
          cachePoint: cacheControl.type
        },
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
            bedrock: {
              ...(msg.providerOptions?.bedrock as Record<string, unknown> || {}),
              cachePoint: cacheControl.type
            },
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
