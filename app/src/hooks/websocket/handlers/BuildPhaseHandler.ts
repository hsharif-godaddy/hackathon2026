/**
 * Handles build_phase events that advance the Design Kit Wizard stepper.
 * Delegates to the shared handleBuildPhaseNotification so WS and SSE produce
 * the same outcome (wizard store update).
 */
import { handleBuildPhaseNotification } from '@/hooks/shared/buildPhaseNotification'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class BuildPhaseHandler implements MessageHandler {
  readonly type = 'build_phase'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    handleBuildPhaseNotification({
      raw: (data.data ?? {}) as Record<string, unknown>,
      clientAppId: context.currentAppId ?? '',
      logPrefix: 'build_phase.websocket',
    })
  }
}
