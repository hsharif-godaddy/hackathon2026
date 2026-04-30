import type { ConversationEventChannel } from '@airo/ai-transport'
import { logger, errorFields } from '../../logging/index.js'
import type { ClientActionRequest, ClientActionResult, IClientActionService } from '../../services/ClientActionService.js'
import { ClientActionRegistry } from '@airo/ai-transport'

export class SSEClientActionService implements IClientActionService {
  private registry: ClientActionRegistry

  constructor(
    private conversationId: string,
    private appId: string,
    private eventChannel: ConversationEventChannel,
  ) {
    this.registry = new ClientActionRegistry((request) => {
      this.eventChannel.publish(this.conversationId, {
        conversationId: this.conversationId,
        type: 'client_action',
        content: '',
        data: {
          action: request.action,
          params: request.params,
          requestId: request.requestId,
          conversationId: this.conversationId,
        },
        agentName: 'system',
      }).catch(err => {
        logger.warn('sse.client-action.publish_failed', {
          conversationId: this.conversationId,
          appId: this.appId,
          ...errorFields(err),
        })
      })
    })
  }

  async executeAction(request: ClientActionRequest): Promise<ClientActionResult> {
    logger.info('sse.client-action.execute', {
      action: request.action,
      conversationId: this.conversationId,
      appId: this.appId,
    })
    return this.registry.executeAction(request)
  }

  resolveAction(data: {
    requestId: string
    success: boolean
    result?: unknown
    error?: string
    errorDetails?: string
    logs?: Array<{ message: string; source?: string; timestamp?: string }>
    exitCode?: number
  }): boolean {
    const { requestId, success, result, error, errorDetails, logs, exitCode } = data

    const actionResult: ClientActionResult = success
      ? { success: true, result }
      : { success: false, error: error || 'Unknown error', errorDetails, logs, exitCode }

    if (success) {
      logger.info('sse.client-action.success', { requestId, conversationId: this.conversationId, appId: this.appId })
    } else {
      logger.error('sse.client-action.error', {
        requestId,
        conversationId: this.conversationId,
        appId: this.appId,
        error,
        hasErrorDetails: !!errorDetails,
        hasLogs: !!logs,
        exitCode,
      })
    }

    const resolved = this.registry.resolveAction(requestId, actionResult)
    if (!resolved) {
      logger.warn('sse.client-action.unknown_request_id', { requestId, conversationId: this.conversationId, appId: this.appId })
    }
    return resolved
  }

  cleanup(): void {
    this.registry.cleanup()
  }
}
