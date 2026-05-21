import { calculateCostEstimate, type TokenUsage } from '@airo/ai-lib'
import { DEBUG_TURN_STATS_EVENT, type DebugTurnStatsEvent } from '@airo/shared/websocket'
import { calculateCacheMetrics, calculateContextWindowUtilization } from './model-context-window.js'

export interface ComputeDebugTurnStatsInput {
  conversationId: string
  agentName: string
  modelName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
}

export function computeDebugTurnStats(input: ComputeDebugTurnStatsInput): DebugTurnStatsEvent {
  const cachedRead = input.cachedInputTokens ?? 0
  const cachedWrite = input.cacheWriteInputTokens ?? 0

  const tokenUsage: TokenUsage = {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    ...(cachedRead > 0 && { cachedInputTokensRead: cachedRead }),
    ...(cachedWrite > 0 && { cachedInputTokensWrite: cachedWrite }),
  }

  const costEstimate = calculateCostEstimate(tokenUsage, input.modelName)
  const cacheMetrics = calculateCacheMetrics(input.inputTokens, cachedRead)
  const contextWindowUtilization = calculateContextWindowUtilization(
    input.inputTokens,
    input.modelName,
  )

  return {
    type: DEBUG_TURN_STATS_EVENT,
    conversationId: input.conversationId,
    agentName: input.agentName,
    modelName: input.modelName,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    cachedInputTokens: cachedRead,
    cacheWriteInputTokens: cachedWrite,
    cacheHitRate: cacheMetrics.cacheHitRate / 100,
    contextWindowUtilization: contextWindowUtilization / 100,
    costUsd: costEstimate.totalCost,
    timestamp: new Date().toISOString(),
  }
}
