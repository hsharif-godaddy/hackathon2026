import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { DataHandlerContext } from './types'

/**
 * Emit load_history if the session hasn't already requested it.
 *
 * Guards:
 *  - conversationId must exist in the cookie for this app
 *  - historyLoadingComplete must be false (history not yet received)
 *  - historyLoadRequested must be false (no in-flight request from another handler)
 *
 * If there is no conversationId this is a brand-new session with no history to
 * fetch — marks historyLoadingComplete immediately so the skeleton is not shown.
 *
 * Returns true if load_history was emitted, false if skipped.
 */
export function emitLoadHistoryIfNeeded(
  context: DataHandlerContext,
  scenario: string
): boolean {
  const conversationId = context.currentAppId
    ? context.helpers.getConversationIdFromCookie(context.currentAppId)
    : null

  const store = useStreamingConversationStore.getState()

  if (!conversationId) {
    if (!store.historyLoadingComplete) {
      store.setHistoryLoadingComplete(true)
    }
    return false
  }

  if (store.historyLoadingComplete || store.historyLoadRequested) {
    return false
  }

  store.setHistoryLoadRequested(true)
  logger.debug('websocket.load_history.emitted', { conversationId, scenario })
  context.socket.emit('load_history', { conversationId })
  return true
}
