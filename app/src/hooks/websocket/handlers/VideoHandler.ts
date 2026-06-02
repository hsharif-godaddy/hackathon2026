/**
 * Handles video generation completion/failure events pushed from the backend.
 * Delegates to the shared `handleVideoNotification` so WS and SSE produce the
 * same customer-visible outcome (store update + Growl toast).
 */

import { handleVideoNotification } from '@/hooks/shared/videoNotification'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class VideoHandler implements MessageHandler {
  readonly type = 'video'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    handleVideoNotification({
      raw: data.data ?? {},
      clientAppId: context.currentAppId,
      t: context.t,
      logPrefix: 'video.websocket',
    })
  }
}
