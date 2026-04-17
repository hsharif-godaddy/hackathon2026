import { useMemo } from 'react'

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { useActiveStream, useMessages } from '@/stores/useStreamingConversationStore'

interface Suggestion {
  text: string
  metadata?: Record<string, unknown>
}

export interface LatestNBAData {
  question: string
  suggestions: Suggestion[]
  rebuildWidget?: unknown
}

function extractNBAFromToolCall(toolCall: ToolCall): LatestNBAData | null {
  if (toolCall.name !== 'suggestedResponse' || toolCall.status !== 'completed' || !toolCall.result) {
    return null
  }

  const resultObj = toolCall.result as any
  const output = resultObj?.output || resultObj
  const widgetData = output?.widgetData

  if (!widgetData?.question || !Array.isArray(widgetData?.suggestions)) {
    return null
  }

  // Filter out malformed items — each suggestion must have a string text field
  const validSuggestions = widgetData.suggestions.filter(
    (s: unknown): s is Suggestion => !!s && typeof (s as Suggestion).text === 'string'
  )

  if (validSuggestions.length === 0) {
    return null
  }

  return {
    question: widgetData.question,
    suggestions: validSuggestions,
    rebuildWidget: output?.rebuildWidget,
  }
}

/**
 * Hook that extracts the latest NBA (suggested response) data from conversation messages.
 * Returns null when no NBA data is available.
 */
export function useLatestNBAs(): LatestNBAData | null {
  const messages = useMessages()
  const activeStream = useActiveStream()

  return useMemo(() => {
    // If there's an active (incomplete) stream, no NBAs to show — agent is working
    if (activeStream && !activeStream.isComplete) {
      return null
    }

    // Check the completed active stream first (most recent)
    if (activeStream?.isComplete && activeStream.toolCalls) {
      for (let i = activeStream.toolCalls.length - 1; i >= 0; i--) {
        const nba = extractNBAFromToolCall(activeStream.toolCalls[i])
        if (nba) return nba
      }
    }

    // Fall back to the last assistant message in the persisted messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
          const nba = extractNBAFromToolCall(msg.toolCalls[j])
          if (nba) return nba
        }
        // Only check the last assistant message
        break
      }
    }

    return null
  }, [messages, activeStream])
}
