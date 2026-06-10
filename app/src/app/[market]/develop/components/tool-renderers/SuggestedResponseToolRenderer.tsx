'use client'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ImmediateSingleSelectChoiceList from '@/app/[market]/develop/components/tool-renderers/ImmediateSingleSelectChoiceList'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

interface Suggestion {
  text: string
  metadata?: Record<string, unknown>
}

interface SuggestedResponseData {
  question: string
  suggestions: Suggestion[]
}

export default function SuggestedResponseToolRenderer({
  toolName: _toolName,
  toolStatus,
  result
}: DefaultToolRendererProps) {
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  if (toolStatus !== 'completed' || !result) {
    return null
  }

  const resultObj = result as Record<string, unknown>
  const output = (resultObj.output ?? resultObj) as { widgetData?: SuggestedResponseData }
  const widgetData = output?.widgetData

  if (!widgetData?.question || !Array.isArray(widgetData.suggestions)) {
    return null
  }

  function handleSuggestionClick(suggestion: Suggestion) {
    if (isProcessing || !sendUserMessage) return
    sendUserMessage(suggestion.text, { isActionRequest: true })
  }

  return (
    <div className="my-2 flex flex-col gap-2">
      <div className="text-sm leading-relaxed break-words">
        {widgetData.question}
      </div>
      <ImmediateSingleSelectChoiceList
        options={widgetData.suggestions.map(s => s.text)}
        ariaLabel={widgetData.question}
        disabled={isProcessing}
        onSelect={(index) => {
          const suggestion = widgetData.suggestions[index]
          if (suggestion) handleSuggestionClick(suggestion)
        }}
      />
    </div>
  )
}
