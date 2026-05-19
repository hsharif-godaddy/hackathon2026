/**
 * Per-LLM-call debug stats emitted by the agents service when
 * DEBUG_STATS_EVENTS=true. Consumed by the frontend Debug Stats Drawer.
 */

export const DEBUG_TURN_STATS_EVENT = 'debug_turn_stats' as const

export interface DebugTurnStatsEvent {
  type: typeof DEBUG_TURN_STATS_EVENT
  conversationId: string
  agentName: string
  modelName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  cacheHitRate: number
  contextWindowUtilization: number
  costUsd: number
  timestamp: string
}
