import type { ActiveDesignKitSuggest } from '@/app/[market]/develop/components/utils/findLatestDesignKitSuggest'
import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'

type PanelMessage = ChatMessage | StreamingMessage

/**
 * The vibe picker stays visible until the user acts. Any user message after the
 * suggestion (a card pick / Skip — both sent as action requests — or a typed vibe)
 * hides it; if the agent re-suggests, a newer `suggestDesignKits` result becomes the
 * latest and the panel reappears. Mirrors {@link isColorSuggestPanelVisible}.
 */
export function isDesignKitSuggestPanelVisible(
  messages: PanelMessage[],
  suggest: ActiveDesignKitSuggest
): boolean {
  const suggestIdx = messages.findIndex((m) => m.id === suggest.messageId)
  if (suggestIdx < 0) return false
  for (let i = suggestIdx + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') return false
  }
  return true
}
