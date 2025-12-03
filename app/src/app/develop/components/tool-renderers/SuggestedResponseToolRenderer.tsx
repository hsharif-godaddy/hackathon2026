'use client'

import Button from '@ux/button'
import Box from '@ux/box'
import { useSendUserMessage } from '@/app/develop/components/chat/ChatContext'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import './SuggestedResponseToolRenderer.css'

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
  const sendUserMessage = useSendUserMessage();
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;

  if (toolStatus !== 'completed' || !result) {
    return null
  }

  const resultObj = result as any
  const widgetData = resultObj?.widgetData as SuggestedResponseData | undefined

  if (!widgetData || !widgetData.question || !widgetData.suggestions) {
    return null
  }

  function handleSuggestionClick(suggestion: Suggestion) {
    if (isProcessing || !sendUserMessage) return;

    sendUserMessage(suggestion.text, { isActionRequest: true });
  }

  return (
    <Box gap="sm" className="my-4">
      <div className="text-sm leading-relaxed break-words mb-2">
        {widgetData.question}
      </div>

      <Box 
        orientation="horizontal" 
        gap="sm" 
        wrap={true}
        inlineAlignChildren="end"
        className="flex-wrap justify-end"
      >
        {widgetData.suggestions.map((suggestion, index) => (
          <Button
            key={index}
            text={suggestion.text}
            design="secondary"
            size="sm"
            disabled={isProcessing}
            onClick={() => handleSuggestionClick(suggestion)}
            className="suggestion-button rounded-md py-2 font-normal"
            style={{
              borderColor: 'var(--color-ai)',
              color: 'var(--color-ai)',
              transition: 'all 0.2s ease'
            }}
          />
        ))}
      </Box>

      <Box 
        orientation="horizontal" 
        gap="sm" 
        inlineAlignChildren="end"
        className="text-xs text-intents-ux-textSubtle-textColor self-end mt-2"
      >
        <svg 
          className="w-6 h-6" 
          fill="currentColor" 
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 3 .97 4.29L2 22l5.71-.97C9 21.64 10.46 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.38 0-2.68-.3-3.86-.83l-.28-.14-2.86.49.49-2.86-.14-.28A7.95 7.95 0 014 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8z"/>
          <path d="M7 9h10v2H7zm0 4h7v2H7z"/>
        </svg>
        <span className="text-sm ">Or, write your own response below</span>
      </Box>
    </Box>
  )
}
