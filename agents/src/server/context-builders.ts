import { observe, updateActiveObservation } from '@langfuse/tracing'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { KnowBDriver } from '../tools/ai-lib-tools/drivers/knowb-driver.js'
import { getKnowledgeServiceDriver } from '../tools/ai-lib-tools/drivers/knowledge-service-driver.js'
import { todoListIdFromContextAttachments } from '../utils/todo-list-id-from-context-attachments.js'
import { getTodoContextManager } from '../services/TodoContextManager.js'
import { BudgetOverride } from '@airo/ai-grants'
import { logger } from '../logging/index.js'

const appRepo = new AppRepository()

export interface ContextMessage {
  role: 'user' | 'system'
  content: string
  insertionOrder: 'before_history' | 'after_history'
  cachePoint?: { type: 'ephemeral' }
}

export function buildDynamicDataMessage(metadata: Record<string, unknown>): ContextMessage {
  const sections: string[] = []

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  sections.push(`Today's date is ${currentDate}`)

  const userTimezone = metadata?.userTimezone
  if (userTimezone) {
    sections.push(`User's timezone: ${userTimezone}`)
  }

  const appId = metadata?.appId as string | undefined
  if (appId) {
    try {
      const app = appRepo.findById(appId)
      if (app?.name) {
        sections.push(`Project title: ${app.name}`)
      }
      if (app?.previewUrl) {
        sections.push(
          `Preview URL (draft builder only; not for custom-domain DNS): ${app.previewUrl}`
        )
      }
    } catch (err) {
      // SQLite failures here would otherwise abort the whole turn. Peer
      // context builders (buildRagContextMessage, buildTodoContextMessage)
      // degrade the same way.
      logger.warn('context.dynamic.app_lookup_failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    role: 'user',
    content: `## Dynamic Context\n\n${sections.join('\n')}`,
    insertionOrder: 'after_history'
  }
}

export async function buildTodoContextMessage(opts: {
  sessionId: string
  appId: string
  metadata: Record<string, unknown>
  contextAttachments?: unknown
  stateManager: {
    getSelectedTodoList: (sessionId: string) => string | undefined
    setSelectedTodoList: (sessionId: string, listId: string) => void
  }
}): Promise<ContextMessage | null> {
  const { sessionId, appId, metadata, contextAttachments, stateManager } = opts

  const fromAttachment = todoListIdFromContextAttachments(contextAttachments)
  const sessionSelectedId = stateManager.getSelectedTodoList(sessionId)
  let selectedTodoListId = sessionSelectedId

  if (fromAttachment) {
    selectedTodoListId = fromAttachment
    stateManager.setSelectedTodoList(sessionId, fromAttachment)
    if (sessionSelectedId && sessionSelectedId !== fromAttachment) {
      logger.info('todo.list.selection.override_from_message', {
        sessionId,
        previousListId: sessionSelectedId,
        listIdFromAttachment: fromAttachment,
        message: 'todo_list_context on user message takes precedence over session selection'
      })
    }
  }

  if (!selectedTodoListId || !appId) return null

  try {
    const todoContextManager = getTodoContextManager()
    const todoContext = await todoContextManager.generateTodoContext(
      { metadata } as any,
      selectedTodoListId
    )
    if (!todoContext) return null

    return {
      role: 'user',
      content: todoContext,
      insertionOrder: 'after_history'
    }
  } catch (err) {
    logger.warn('context.todo.build_failed', {
      sessionId, appId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function searchDocumentation(params: {
  query: string
  kbNodeIds: string[]
  maxResults: number
  scoreThreshold: number
  appId?: string | undefined
  sessionId?: string | undefined
}) {
  const knowledgeDriver = getKnowledgeServiceDriver()

  updateActiveObservation({
    metadata: {
      retrievalType: 'semantic_search',
      retrievalBackend: knowledgeDriver ? 'knowledge-service' : 'knowb',
      appId: params.appId,
      sessionId: params.sessionId,
      maxResults: params.maxResults,
      scoreThreshold: params.scoreThreshold
    }
  })

  const driver = knowledgeDriver ?? new KnowBDriver()

  const result = await driver.search({
    query: params.query,
    kbNodeIds: params.kbNodeIds,
    maxResults: params.maxResults,
    scoreThreshold: params.scoreThreshold,
  })

  if (!result.success || !result.results || result.results.length === 0) {
    updateActiveObservation({
      metadata: {
        documentsRetrieved: 0,
        noResults: true
      }
    })
    return null
  }

  const docsContent = driver.formatResultsAsMarkdown(result.results)

  updateActiveObservation({
    metadata: {
      documentsRetrieved: result.results.length,
      avgScore: result.results.reduce((sum, r) => sum + (r.score || 0), 0) / result.results.length,
      allScoresAboveThreshold: result.results.every(r => (r.score || 0) >= params.scoreThreshold),
      documentIds: result.results.map(r => r.kbNodeId).filter(Boolean)
    }
  })

  return {
    content: docsContent,
    results: result.results,
    count: result.results.length
  }
}

const tracedSearchDocumentation = observe(searchDocumentation, {
  name: 'Documentation Retrieval',
  asType: 'span'
})

export async function buildRagContextMessage(opts: {
  userMessage: string
  appId?: string
  sessionId?: string
}): Promise<ContextMessage | null> {
  const { userMessage, appId, sessionId } = opts
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return null
  }

  try {
    const retrievalResult = await tracedSearchDocumentation({
      query: userMessage,
      kbNodeIds: ['/airo_info'],
      maxResults: 5,
      scoreThreshold: 0.50,
      appId,
      sessionId,
    })

    if (!retrievalResult?.results?.length) return null

    return {
      role: 'user',
      content: `[Relevant Documentation from Knowledge Base]\n\n${retrievalResult.content}\n\n---\n*Use this documentation to inform your response, but respond naturally without explicitly referencing it unless directly relevant.*`,
      insertionOrder: 'after_history'
    }
  } catch (error) {
    logger.warn('context.rag.search_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: userMessage.substring(0, 100)
    })
    return null
  }
}

export { dataUrlsToProcessedFiles } from '@airo/ai-lib'

export function checkAndTriggerSummarization(opts: {
  inputTokens: number
  appId: string
  conversationId?: string
  subscriptionId?: string
  summarizer: {
    checkAndSummarize(appId: string, triggerTokenCount?: number, budgetOverride?: string): Promise<void>
    getMaxPromptTokens(): number
  }
}): void {
  const { inputTokens, appId, conversationId, subscriptionId, summarizer } = opts
  const maxPrompt = summarizer.getMaxPromptTokens()
  if (inputTokens <= maxPrompt) return

  const budgetOverride = (subscriptionId === BudgetOverride.CareAgent || subscriptionId === BudgetOverride.TestAccounts)
    ? subscriptionId : undefined

  logger.info('summarization.trigger', { appId, conversationId, inputTokens, maxPrompt, budgetOverride })
  summarizer.checkAndSummarize(appId, inputTokens, budgetOverride).catch(err => {
    logger.warn('summarization.failed', { appId, conversationId, error: err instanceof Error ? err.message : String(err) })
  })
}

export function collectImagesFromFormattedContexts(
  formattedContexts: Array<{ screenshot?: string; assetImages?: string[] }> | undefined
): string[] {
  if (!formattedContexts) return []
  const allImages: string[] = []
  for (const formatted of formattedContexts) {
    if (formatted.screenshot) allImages.push(formatted.screenshot)
    if (formatted.assetImages && Array.isArray(formatted.assetImages)) {
      allImages.push(...formatted.assetImages)
    }
  }
  return allImages
}
