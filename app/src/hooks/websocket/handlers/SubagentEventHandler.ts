import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

interface SubagentEventData {
  subagentToolId: string
  agent: string
  event: string
  detail: string
}

export class SubagentEventHandler implements MessageHandler {
  readonly type = 'subagent_event'

  async handle(data: WebSocketMessage, _context: MessageContext): Promise<void> {
    const payload = data as unknown as SubagentEventData
    if (!payload.subagentToolId || !payload.agent) return

    useStreamingConversationStore.getState().addSubagentEvent(
      payload.subagentToolId,
      { event: payload.event, agent: payload.agent, detail: payload.detail }
    )
  }
}
