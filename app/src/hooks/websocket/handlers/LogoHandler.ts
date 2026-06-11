/**
 * Handles logo generation completion/failure events pushed from the backend.
 * Delegates to the shared `handleLogoNotification` so WS and SSE produce the
 * same customer-visible outcome (store update + preview reload + Growl toast).
 */

import { handleLogoNotification } from '@/hooks/shared/logoNotification'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class LogoHandler implements MessageHandler {
  readonly type = 'logo'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    handleLogoNotification({
      raw: data.data ?? {},
      clientAppId: context.currentAppId,
      t: context.t,
      logPrefix: 'logo.websocket',
    })
  }
}
