import { observe, updateActiveObservation } from '@langfuse/tracing'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { knowBDriver } from '../tools/ai-lib-tools/drivers/knowb-driver.js'
import { todoListIdFromContextAttachments } from '../utils/todo-list-id-from-context-attachments.js'
import { getTodoContextManager } from '../services/TodoContextManager.js'
import { memoryContextProvider } from '../services/memory-singletons.js'
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

  if (!appId) return null

  const todoContextManager = getTodoContextManager()

  try {
    if (!selectedTodoListId) {
      const incompleteList = await todoContextManager.getCurrentIncompleteList(appId)
      if (incompleteList) {
        selectedTodoListId = incompleteList.id
        stateManager.setSelectedTodoList(sessionId, incompleteList.id)
        logger.info('todo.list.selection.resolved_from_db', {
          sessionId, appId, listId: incompleteList.id,
        })
      }
    }

    if (!selectedTodoListId) return null

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
  appId?: string | undefined
  sessionId?: string | undefined
}) {
  updateActiveObservation({
    metadata: {
      retrievalType: 'semantic_search',
      retrievalBackend: 'knowb',
      searchType: 'LEXICAL_AND_SEMANTIC',
      reranking: 'cohere-v3.5',
      overFetchCount: 15,
      dedupStrategy: 'per-kbNodeId',
      appId: params.appId,
      sessionId: params.sessionId,
    }
  })

  // Let the driver own maxResults + scoreThreshold defaults (3, 0.0).
  // Hardcoding 0.5 here would silently drop nearly all Cohere rerank hits —
  // see knowb-driver.ts docblock.
  const result = await knowBDriver.search({
    query: params.query,
    kbNodeIds: params.kbNodeIds,
  })

  if (!result.success) {
    logger.warn('context.rag.knowb_search_failed', {
      error: result.error,
      appId: params.appId,
      sessionId: params.sessionId,
      query: params.query.substring(0, 100),
    })
    updateActiveObservation({
      metadata: { documentsRetrieved: 0, searchFailed: true, error: result.error }
    })
    return null
  }

  if (!result.results || result.results.length === 0) {
    updateActiveObservation({
      metadata: { documentsRetrieved: 0, noResults: true }
    })
    return null
  }

  const docsContent = knowBDriver.formatResultsAsMarkdown(result.results)

  const scores = result.results.map(r => r.score || 0)
  const topScore = scores[0] ?? 0
  // Separation gap — how far #1 is ahead of #2. Cohere rerank scores are
  // probability-calibrated, so raw threshold is unreliable; gap is a
  // better confidence signal. Relevant queries observed 0.03–0.61 gap,
  // irrelevant queries cluster <0.02. Undefined when <2 results so
  // downstream readers don't confuse topScore-vs-0 with a real gap.
  const gapTop1ToTop2 = scores.length >= 2 ? topScore - scores[1]! : null
  updateActiveObservation({
    metadata: {
      documentsRetrieved: result.results.length,
      avgScore: scores.reduce((sum, s) => sum + s, 0) / scores.length,
      topScore,
      gapTop1ToTop2,
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
    // Broader event name + errorType — this catch wraps the Langfuse
    // observe() scaffolding, formatResultsAsMarkdown, AND the driver call,
    // so a tracing/instrumentation throw is indistinguishable from a
    // GoKnowb failure without errorType. Driver-layer failures are logged
    // under context.rag.knowb_search_failed / knowb-driver.search.* and
    // reach this branch only if something re-throws above them.
    logger.warn('context.rag.build_failed', {
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      appId,
      sessionId,
      query: userMessage.substring(0, 100)
    })
    return null
  }
}

export async function buildMemoryContextMessage(opts: {
  appId: string
}): Promise<ContextMessage | null> {
  const { appId } = opts
  if (!appId) return null

  try {
    const contextString = await memoryContextProvider.getContextString(appId)
    if (!contextString) return null

    return {
      role: 'user',
      content: contextString,
      insertionOrder: 'after_history'
    }
  } catch (err) {
    logger.warn('context.memory.build_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
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
  customerId?: string
  summarizer: {
    checkAndSummarize(appId: string, triggerTokenCount?: number, budgetOverride?: string, customerId?: string): Promise<void>
    getMaxPromptTokens(): number
  }
}): void {
  const { inputTokens, appId, conversationId, subscriptionId, customerId, summarizer } = opts
  const maxPrompt = summarizer.getMaxPromptTokens()
  if (inputTokens <= maxPrompt) return

  const budgetOverride = (subscriptionId === BudgetOverride.CareAgent || subscriptionId === BudgetOverride.TestAccounts)
    ? subscriptionId : undefined

  logger.info('summarization.trigger', { appId, conversationId, inputTokens, maxPrompt, budgetOverride })
  summarizer.checkAndSummarize(appId, inputTokens, budgetOverride, customerId).catch(err => {
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
