import {
  calculateCostEstimate,
  formatCostEstimate,
  getCacheHitRate,
  calculateCacheMetrics,
  calculateContextWindowUtilization,
  type TokenUsage,
} from '@airo/ai-lib'

/**
 * Minimal structured logger contract. Both transports pass their own
 * `logger`. Methods must not throw — observability is additive and must
 * never abort a turn.
 */
export interface TokenUsageObservabilityLogger {
  info: (event: string, data?: Record<string, unknown>) => void
  warn: (event: string, data: Record<string, unknown>) => void
  error: (event: string, data: Record<string, unknown>) => void
}

/**
 * APM token tracker — structurally mirrors the `trackTokenUsageInAPM` method on
 * the agents service's `AgentsMessagePersistence`. Declared here (rather than
 * imported) because `@airo/ai-transport` must not depend on `agents`. Keep this
 * signature in sync with `agents/src/server/conversation-persistence.ts`.
 */
export interface TokenUsageApmTracker {
  trackTokenUsageInAPM(
    type: 'main_agent' | 'handoff',
    usage: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    },
    metadata: {
      conversationId: string
      appId: string
      agentName: string
      modelName: string
      targetAgent?: string
    },
  ): void
}

export interface TokenUsageObservabilityParams {
  /**
   * Per-call usage in the `@airo/ai-lib` `TokenUsage` shape — exactly what
   * `buildTokenUsage()` returns and `calculateCostEstimate()` consumes. SSE
   * passes `buildTokenUsage(...)` straight through; WS maps its `onTokenUsage`
   * callback fields (cachedInputTokens/cacheWriteInputTokens) into this shape
   * at the single call site.
   */
  usage: TokenUsage
  metadata: {
    appId?: string | undefined
    agentName: string
    modelName: string
    conversationId?: string | undefined
  }
  apmTracker: TokenUsageApmTracker
  logger: TokenUsageObservabilityLogger
  /**
   * Log-event namespace prefix for the appId-scoped events so WS and SSE turns
   * stay distinguishable in Loki. Emits `${eventPrefix}.tracked`,
   * `${eventPrefix}.no_app_id`, and `${eventPrefix}.tracking_failed`. WS passes
   * 'websocket.token_usage' (preserving its historical names); SSE passes
   * 'sse.token_usage'. (The granular `token.usage`/`token.cache`/`token.cost`
   * logs below are intentionally unprefixed — identical across both transports.)
   */
  eventPrefix: string
}

export interface TokenUsageObservabilityResult {
  /** Estimated cost for this call, or undefined if it could not be computed. */
  totalCost: number | undefined
}

/**
 * Record per-LLM-call token observability for both transports:
 *  - granular `token.usage` / `token.cache`(`.none`) / `token.cost` info logs,
 *  - APM token tracking,
 *  - a consolidated `${eventPrefix}.tracked` log (cost, cache-hit rate,
 *    context-window utilization),
 * and returns the estimated cost so callers can attach it to the Langfuse
 * invocation span.
 *
 * This is the single source of truth for token cost/APM observability shared
 * by the WebSocket (`onTokenUsage` adapter) and SSE (`MessageExecutionService`)
 * paths. Transport-agnostic and self-contained: a token-calc, APM, or logging
 * failure is caught and logged as `${eventPrefix}.tracking_failed` rather than
 * propagated (the one exception is a misbehaving injected logger that throws
 * from `.error`, which would defeat the catch). The granular logs are produced
 * regardless of appId (matching the WS base server's historical behavior);
 * only APM + the `.tracked` log require an appId.
 *
 * Cost is computed first and returned even when the downstream side-effecting
 * observability (APM / logs) fails — the span must not lose an already-computed
 * cost, matching the WS base server's pre-consolidation behavior where the span
 * cost was set independently of the APM callback. The only "no cost" case is
 * `calculateCostEstimate` itself throwing (e.g. an unknown-model lookup).
 */
export function recordTokenUsageObservability(
  params: TokenUsageObservabilityParams,
): TokenUsageObservabilityResult {
  const { usage, metadata, apmTracker, logger, eventPrefix } = params

  const failurePayload = (error: unknown): Record<string, unknown> => ({
    error: error instanceof Error ? error.message : String(error),
    appId: metadata.appId,
    agentName: metadata.agentName,
    modelName: metadata.modelName,
  })

  // Cost is a pure computation and the value the span needs — isolate it so a
  // later side-effect failure can never discard it.
  let costEstimate
  try {
    costEstimate = calculateCostEstimate(usage, metadata.modelName)
  } catch (error) {
    logger.error(`${eventPrefix}.tracking_failed`, failurePayload(error))
    return { totalCost: undefined }
  }

  // Side-effecting observability (granular logs + APM + consolidated log). A
  // failure here is logged but must not drop the cost computed above.
  try {
    // Granular per-call logs — unprefixed and emitted for both transports
    // regardless of appId (they carry no appId, and WS has always logged them
    // unconditionally).
    logger.info('token.usage', {
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      totalTokens: usage.totalTokens || 0,
    })

    const totalCachedTokens = (usage.cachedInputTokensRead || 0) + (usage.cachedInputTokensWrite || 0)
    if (totalCachedTokens > 0) {
      const cacheDetails: Record<string, unknown> = {
        totalCachedTokens,
        cacheHitRate: getCacheHitRate(usage).toFixed(1) + '%',
      }
      if (usage.cachedInputTokensRead && usage.cachedInputTokensWrite) {
        cacheDetails.read = usage.cachedInputTokensRead
        cacheDetails.write = usage.cachedInputTokensWrite
      } else if (usage.cachedInputTokensRead) {
        cacheDetails.read = usage.cachedInputTokensRead
      } else if (usage.cachedInputTokensWrite) {
        cacheDetails.write = usage.cachedInputTokensWrite
      }
      logger.info('token.cache', cacheDetails)
    } else {
      logger.info('token.cache.none')
    }

    logger.info('token.cost', { details: formatCostEstimate(costEstimate, usage).join('; ') })

    // APM + the consolidated business log require an appId.
    if (metadata.appId) {
      apmTracker.trackTokenUsageInAPM(
        'main_agent',
        {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cacheReadTokens: usage.cachedInputTokensRead || 0,
          cacheWriteTokens: usage.cachedInputTokensWrite || 0,
        },
        {
          conversationId: metadata.conversationId || 'unknown',
          appId: metadata.appId,
          agentName: metadata.agentName,
          modelName: metadata.modelName,
        },
      )

      const cacheMetrics = calculateCacheMetrics(usage.inputTokens, usage.cachedInputTokensRead)
      const contextUtilization = calculateContextWindowUtilization(usage.inputTokens, metadata.modelName)

      logger.info(`${eventPrefix}.tracked`, {
        appId: metadata.appId,
        agentName: metadata.agentName,
        modelName: metadata.modelName,
        conversationId: metadata.conversationId,
        inputTokens: usage.inputTokens,
        cachedInputTokens: cacheMetrics.cachedTokens,
        freshInputTokens: cacheMetrics.freshTokens,
        totalTokens: usage.totalTokens,
        cost: costEstimate.totalCost,
        contextWindowUtilization: contextUtilization,
        cacheHitRate: cacheMetrics.cacheHitRate,
        hasConversation: !!metadata.conversationId,
      })
    } else {
      logger.warn(`${eventPrefix}.no_app_id`, {
        agentName: metadata.agentName,
        modelName: metadata.modelName,
        conversationId: metadata.conversationId,
      })
    }
  } catch (error) {
    logger.error(`${eventPrefix}.tracking_failed`, failurePayload(error))
  }

  return { totalCost: costEstimate.totalCost }
}
