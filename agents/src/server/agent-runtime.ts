import { ConversationEventChannel } from '@airo/ai-transport'
import { destroyLlmDispatcher } from '@airo/ai-lib'
import { createWebSocketAgentFactory } from '../agents/ai-lib-agents/index.js'
import { initializeContextRegistry } from '../services/initializeContextRegistry.js'
import { GitHookService } from '../services/git-hook-service.js'
import { LifecycleSessionStore, type MessageLifecycleDeps } from './message-lifecycle.js'
import { getAssessmentAgent } from '../agents/assessment-agent/index.js'
import type { IClientActionService } from '../services/ClientActionService.js'
import { logger } from '../logging/index.js'

type AgentFactory = Awaited<ReturnType<typeof createWebSocketAgentFactory>>

let eventChannelInstance: ConversationEventChannel | null = null
let eventChannelCleanupInterval: NodeJS.Timeout | null = null
let agentFactoryInstance: AgentFactory | null = null
let initialized = false

const actionServices = new Map<string, IClientActionService>()

const gitHookService = new GitHookService()
const lifecycleSessionStore = new LifecycleSessionStore()
const lifecycleDeps: MessageLifecycleDeps = {
  gitHookService,
  getAssessmentAgent,
  sessionStore: lifecycleSessionStore,
  logger,
}

export async function initAgentRuntime(): Promise<void> {
  if (initialized) return

  try {
    initializeContextRegistry()

    const agentFactory = await createWebSocketAgentFactory()

    const { todoListTool } = await import('../tools/todo-list-tool.js')
    todoListTool.setOnSelectCallback((sessionId: string, listId: string) => {
      agentFactory.stateManager.setSelectedTodoList(sessionId, listId)
      logger.info('todo.list.selected', { sessionId, listId })
    })

    const { initializeBackgroundSummarization } = await import('../services/summarization/index.js')
    await initializeBackgroundSummarization()

    const channel = new ConversationEventChannel()

    const cleanupInterval = setInterval(() => {
      const removed = channel.cleanup() ?? 0
      if (removed > 0) {
        logger.debug('sse.event_channel.cleanup', { removedConversations: removed })
      }
    }, 60_000)
    cleanupInterval.unref?.()

    // Assign module state only after all async work succeeds
    agentFactoryInstance = agentFactory
    eventChannelInstance = channel
    eventChannelCleanupInterval = cleanupInterval
    initialized = true
    logger.info('agent_runtime.initialized')
  } catch (error) {
    // Reset any partially-assigned state so retry is clean
    agentFactoryInstance = null
    eventChannelInstance = null
    if (eventChannelCleanupInterval) {
      clearInterval(eventChannelCleanupInterval)
      eventChannelCleanupInterval = null
    }
    throw error
  }
}

export function getEventChannel(): ConversationEventChannel | null {
  return eventChannelInstance
}

export function getAgentFactory(): AgentFactory | null {
  return agentFactoryInstance
}

export function getMessageLifecycleDeps(): MessageLifecycleDeps {
  return lifecycleDeps
}

export function getGitHookService(): GitHookService {
  return gitHookService
}

export function registerActionService(key: string, service: IClientActionService): void {
  actionServices.set(key, service)
}

export function getActionService(key: string): IClientActionService | null {
  return actionServices.get(key) ?? null
}

export function cleanupActionService(key: string): void {
  const service = actionServices.get(key)
  if (service) {
    service.cleanup()
    actionServices.delete(key)
    logger.info('action_service.cleaned_up', { key })
  }
}

export async function destroyAgentRuntime(): Promise<void> {
  if (eventChannelCleanupInterval) {
    clearInterval(eventChannelCleanupInterval)
    eventChannelCleanupInterval = null
  }

  for (const [key, service] of actionServices) {
    try {
      service.cleanup()
    } catch (error) {
      logger.warn('agent_runtime.destroy.service_cleanup_error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    actionServices.delete(key)
  }

  await destroyLlmDispatcher()

  eventChannelInstance = null
  agentFactoryInstance = null
  initialized = false
  logger.info('agent_runtime.destroyed')
}
