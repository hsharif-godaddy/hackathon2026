/**
 * Stream Retry Handler
 *
 * Handles stream_retry events from the server when a mid-stream budget exceeded
 * error triggers grant advancement and retry. Clears partial stream segments
 * so the retried stream starts with a clean UI.
 */

import { logger } from '@/lib/request-context'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class StreamRetryHandler implements MessageHandler {
  readonly type = 'stream_retry'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (context.refs.controller?.isInReplayMode()) return

    logger.info('websocket.stream_retry', {
      reason: data.data?.reason,
      agentName: data.data?.agentName,
    })

    context.actions.clearStreamForRetry()
  }
}
