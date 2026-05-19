import { DEBUG_TURN_STATS_EVENT, type DebugTurnStatsEvent } from '@airo/shared/websocket'
import { logger } from '../logging/index.js'
import { getSocketIO, isAppEligibleForEmit } from './ai-lib-websocket-server.js'

export interface MaybeEmitDebugTurnStatsArgs {
  appId: string
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
}

/**
 * Emit debug_turn_stats only to authenticated sockets for `appId` whose JWT
 * has the `debugStatsEnabled` claim set. The same `appbuilder-debug-drawer`
 * Switchboard flag that gates the UI also gates the BFF setting this claim,
 * so production users never receive these events.
 */
export function maybeEmitDebugTurnStats(args: MaybeEmitDebugTurnStatsArgs): void {
  // Wrap the entire body so a debug-only side channel can never break the
  // primary cost-tracking / summarization path it's invoked from.
  try {
    if (!args.appId) return
    const io = getSocketIO()
    if (!io) return

    const payload: DebugTurnStatsEvent = {
      type: DEBUG_TURN_STATS_EVENT,
      conversationId: args.conversationId,
      agentName: args.agentName,
      modelName: args.modelName,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      cachedInputTokens: args.cachedInputTokens,
      cacheWriteInputTokens: args.cacheWriteInputTokens,
      cacheHitRate: args.cacheHitRate,
      contextWindowUtilization: args.contextWindowUtilization,
      costUsd: args.costUsd,
      timestamp: new Date().toISOString(),
    }

    let total = 0
    let eligible = 0
    let claimEnabled = 0
    let delivered = 0
    for (const socket of io.sockets.sockets.values()) {
      total++
      if (!isAppEligibleForEmit(socket, args.appId)) continue
      eligible++
      const agentContext = socket.handshake.auth?.agentContext as { debugStatsEnabled?: boolean } | undefined
      if (agentContext?.debugStatsEnabled !== true) continue
      claimEnabled++
      socket.emit(DEBUG_TURN_STATS_EVENT, payload)
      delivered++
    }

    if (delivered > 0) {
      logger.debug('debug_stats.emit', {
        appId: args.appId,
        conversationId: args.conversationId,
        costUsd: args.costUsd,
        socketsTotal: total,
        socketsEligibleForApp: eligible,
        socketsWithClaim: claimEnabled,
        delivered,
      })
    }
  } catch (error) {
    logger.warn('debug_stats.emit_failed', {
      appId: args.appId,
      conversationId: args.conversationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
