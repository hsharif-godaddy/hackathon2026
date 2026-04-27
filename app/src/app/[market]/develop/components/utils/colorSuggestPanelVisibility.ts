import type { ActiveColorSchemeSuggest } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest'
import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'

type PanelMessage = ChatMessage | StreamingMessage

export function isColorSuggestPanelVisible(
  messages: PanelMessage[],
  suggest: ActiveColorSchemeSuggest,
  translate: (key: string, values?: Record<string, unknown>, defaultMessage?: string) => string
): boolean {
  const suggestIdx = messages.findIndex((m) => m.id === suggest.messageId)
  if (suggestIdx < 0) return false

  const moreText = translate('builder_tools_css_color_scheme_more_options', undefined, 'Show me more color scheme options')

  for (let i = suggestIdx + 1; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const c = m.content.trim()
    if (c !== moreText) return false
  }
  return true
}
