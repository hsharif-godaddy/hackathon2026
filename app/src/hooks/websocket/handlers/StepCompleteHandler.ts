/**
 * Step Complete Handler
 *
 * Handles step_complete messages indicating a reasoning step has finished.
 * Marks if maximum steps were reached.
 */

import { logger } from '@/lib/request-context'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class StepCompleteHandler implements MessageHandler {
  readonly type = 'step_complete'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    if (data.data?.maxStepsReached === true) {
      logger.warn('websocket.steps.max-reached')
      context.actions.markMaxStepsReached()
    }
  }
}
