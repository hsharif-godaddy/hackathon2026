/**
 * Server Config Handler
 *
 * Handles server configuration messages received during WebSocket handshake.
 * Stores timeout values for synchronization between client and server.
 */

import { logger } from '@/lib/request-context'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

const CONNECTION_RETRY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes - fallback default

export class ServerConfigHandler implements MessageHandler {
  readonly type = 'server_config'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    // Server sends configuration during handshake for timeout synchronization
    // This ensures client and server use the same recovery window
    context.refs.serverConfig.current = {
      streamRecoveryWindow: (data.data?.streamRecoveryWindow as number | undefined) ?? CONNECTION_RETRY_TIMEOUT_MS,
      ackTimeout: (data.data?.ackTimeout as number | undefined) ?? 30000
    }

    logger.info('websocket.server_config.received', {
      streamRecoveryWindow: context.refs.serverConfig.current.streamRecoveryWindow,
      ackTimeout: context.refs.serverConfig.current.ackTimeout
    })
  }
}
