import { logger } from '@/lib/request-context'
import { type AgentSummary, useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class AgentsAvailableHandler implements MessageHandler {
  readonly type = 'agents_available'

  async handle(data: WebSocketMessage, _context: MessageContext): Promise<void> {
    const payload = data.data as { agents?: unknown; defaultAgent?: unknown } | undefined
    const rawAgents = Array.isArray(payload?.agents) ? payload?.agents : []
    const sanitizedAgents: AgentSummary[] = rawAgents
      .map((agent): AgentSummary | null => {
        const idValue = agent?.id ?? agent?.agentId ?? agent?.name
        const id = typeof idValue === 'string' ? idValue : idValue != null ? String(idValue) : null
        if (!id) {
          return null
        }

        const nameValue = agent?.name ?? id
        return {
          id,
          name: typeof nameValue === 'string' ? nameValue : String(nameValue),
          description: typeof agent?.description === 'string' ? agent.description : undefined
        }
      })
      .filter((agent): agent is AgentSummary => agent !== null)

    const defaultAgentValue = payload?.defaultAgent
    const defaultAgentId =
      typeof defaultAgentValue === 'string'
        ? defaultAgentValue
        : defaultAgentValue != null
          ? String(defaultAgentValue)
          : null

    const store = useStreamingConversationStore.getState()
    store.setAgentCatalog(sanitizedAgents, defaultAgentId)

    logger.debug('websocket.agents.available', {
      count: sanitizedAgents.length,
      defaultAgentId,
      message: 'Server will send history_complete for consistent initialization'
    })
  }
}
