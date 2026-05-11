import type { AgentsAppContext } from '../types/websocket-context.js'

/**
 * Select the conversationId to write into `budgetReportConversationCache` for OTel
 * cost-attribution context. Prefers `context.metadata.conversationId` (server-populated
 * by `attachConversationId` before `onMessageStart`) over the client-sent
 * `context.conversation.conversationId`. Returns a tagged `{ value, source }` so the
 * call site can log which field was used without re-deriving it.
 *
 * Lives in its own side-effect-free module so unit tests do not import the full
 * websocket server (which opens the SQLite DB and constructs GitHookService at
 * module load). See `__tests__/budget-report-conversation-cache.test.ts`.
 */
export type CacheConversationIdSelection =
  | { value: string; source: 'metadata' | 'conversation' }
  | { value: undefined; source: 'none' }

export function selectCacheConversationId(
  context: AgentsAppContext | undefined,
): CacheConversationIdSelection {
  const fromMetadata = context?.metadata?.conversationId
  if (typeof fromMetadata === 'string' && fromMetadata.length > 0) {
    return { value: fromMetadata, source: 'metadata' }
  }

  const fromConversation = context?.conversation?.conversationId
  if (typeof fromConversation === 'string' && fromConversation.length > 0) {
    return { value: fromConversation, source: 'conversation' }
  }

  return { value: undefined, source: 'none' }
}
