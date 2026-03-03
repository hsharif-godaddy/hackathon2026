/**
 * Step Complete Handler
 *
 * Handles step_complete messages indicating a reasoning step has finished.
 * Marks if maximum steps were reached.
 */

import { logger } from '@/lib/request-context'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class StepCompleteHandler implements MessageHandler {
  readonly type = 'step_complete'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (data.data?.maxStepsReached === true) {
      logger.warn('websocket.steps.max-reached')
      context.actions.markMaxStepsReached()
    }
  }
}
