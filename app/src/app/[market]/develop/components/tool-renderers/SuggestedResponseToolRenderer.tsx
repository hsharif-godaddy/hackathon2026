'use client'

import { ChoiceList } from '@airo/components/input/choice-list'
import Box from '@ux/box'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import { parseChoiceListIndex } from '@/app/[market]/develop/components/tool-renderers/choiceListIndex'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { useTranslations } from '@/hooks/useTranslations'
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
  const t = useTranslations();
  const sendUserMessage = useSendUserMessage();
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;

  if (toolStatus !== 'completed' || !result) {
    return null
  }

  const resultObj = result as any
  const output = resultObj?.output || resultObj
  const widgetData = output?.widgetData as SuggestedResponseData | undefined

  if (!widgetData || !widgetData.question || !widgetData.suggestions) {
    return null
  }

  function handleSuggestionClick(suggestion: Suggestion) {
    if (isProcessing || !sendUserMessage) return;

    sendUserMessage(suggestion.text, { isActionRequest: true });
  }

  return (
    <Box gap="sm" className="my-2">

      <div className="text-sm leading-relaxed break-words mb-1">
        {widgetData.question}
      </div>

      <ChoiceList
        onDecision={(value) => {
          const index = parseChoiceListIndex(value, 'suggested-response')
          if (index === null) return
          const suggestion = widgetData.suggestions[index]
          if (suggestion) handleSuggestionClick(suggestion)
        }}
        ariaLabel={widgetData.question}
        disabled={isProcessing}
        optionDividers
      >
        {widgetData.suggestions.map((suggestion, index) => (
          <ChoiceList.Item key={index} value={String(index)}>
            {suggestion.text}
          </ChoiceList.Item>
        ))}
      </ChoiceList>

      <Box
        orientation="horizontal"
        gap="sm"
        inlineAlignChildren="start"
        className="text-xs text-intents-ux-textSubtle-textColor mt-1"
      >
        <span className="text-sm ">{t('builder_tools_suggested_response')}</span>
      </Box>
    </Box>
  )
}
