import { DEBUG_TURN_STATS_EVENT } from '@airo/shared/websocket'
import { logger } from '../logging/index.js'
import { computeDebugTurnStats, type ComputeDebugTurnStatsInput } from '../utils/debug-turn-stats.js'
import { getSocketIO, isAppEligibleForEmit } from './ai-lib-websocket-server.js'

export interface MaybeEmitDebugTurnStatsArgs extends ComputeDebugTurnStatsInput {
  appId: string
}

/**
 * Emit debug_turn_stats only to authenticated sockets for `appId` whose JWT
 * has the `debugStatsEnabled` claim set. The same `appbuilder-debug-drawer`
 * Switchboard flag that gates the UI also gates the BFF setting this claim,
 * so production users never receive these events.
 */
export function maybeEmitDebugTurnStats(args: MaybeEmitDebugTurnStatsArgs): void {
  try {
    if (!args.appId) return
    const io = getSocketIO()
    if (!io) return

    const eligibleSockets: Array<{ emit: (event: string, payload: unknown) => void }> = []
    for (const socket of io.sockets.sockets.values()) {
      if (!isAppEligibleForEmit(socket, args.appId)) continue
      const agentContext = socket.handshake.auth?.agentContext as { debugStatsEnabled?: boolean } | undefined
      if (agentContext?.debugStatsEnabled !== true) continue
      eligibleSockets.push(socket)
    }
    if (eligibleSockets.length === 0) return

    const payload = computeDebugTurnStats({
      conversationId: args.conversationId,
      agentName: args.agentName,
      modelName: args.modelName,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      cachedInputTokens: args.cachedInputTokens,
      cacheWriteInputTokens: args.cacheWriteInputTokens,
    })

    for (const socket of eligibleSockets) {
      socket.emit(DEBUG_TURN_STATS_EVENT, payload)
    }
    const delivered = eligibleSockets.length

    if (delivered > 0) {
      logger.debug('debug_stats.emit', {
        appId: args.appId,
        conversationId: args.conversationId,
        costUsd: payload.costUsd,
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
