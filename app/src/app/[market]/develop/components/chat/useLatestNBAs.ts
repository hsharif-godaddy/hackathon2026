import { useMemo } from 'react'

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { useActiveStream, useMessages } from '@/stores/useStreamingConversationStore'

interface Suggestion {
  text: string
  value?: string
  metadata?: Record<string, unknown>
}

export interface LatestNBAData {
  question: string
  suggestions: Suggestion[]
  allowOther?: boolean
  source?: 'suggestedResponse' | 'askQuestion'
  toolResult?: Record<string, unknown> | string
}

function extractNBAFromToolCall(toolCall: ToolCall): LatestNBAData | null {
  if (toolCall.status !== 'completed' || !toolCall.result) {
    return null
  }

  if (toolCall.name === 'suggestedResponse') {
    return extractSuggestedResponse(toolCall)
  }

  if (toolCall.name === 'askQuestion') {
    return extractAskQuestion(toolCall)
  }

  return null
}

function extractSuggestedResponse(toolCall: ToolCall): LatestNBAData | null {
  const resultObj = toolCall.result as any
  const output = resultObj?.output || resultObj
  const widgetData = output?.widgetData

  if (!widgetData?.question || !Array.isArray(widgetData?.suggestions)) {
    return null
  }

  const validSuggestions = widgetData.suggestions.filter(
    (s: unknown): s is Suggestion => !!s && typeof (s as Suggestion).text === 'string'
  )

  if (validSuggestions.length === 0) {
    return null
  }

  return {
    question: widgetData.question,
    suggestions: validSuggestions,
    source: 'suggestedResponse',
  }
}

function extractAskQuestion(toolCall: ToolCall): LatestNBAData | null {
  const resultObj = toolCall.result as any
  const output = resultObj?.output || resultObj
  const widgetData = output?.widgetData

  if (!widgetData?.questions || !Array.isArray(widgetData.questions) || widgetData.questions.length === 0) {
    return null
  }

  // For the chat area, render the first (or current) question
  const currentIndex = widgetData.currentQuestionIndex ?? 0
  const currentQuestion = widgetData.questions[currentIndex]
  if (!currentQuestion?.question || !Array.isArray(currentQuestion.suggestions)) {
    return null
  }

  const validSuggestions = currentQuestion.suggestions.filter(
    (s: unknown): s is Suggestion => !!s && typeof (s as Suggestion).text === 'string'
  )

  // Text-input questions intentionally have no chip suggestions — the user
  // types a free-text answer (e.g. a URL). Reject empty suggestions only for
  // chip-style questions, where zero options means an unanswerable step.
  if (validSuggestions.length === 0 && currentQuestion.type !== 'text') {
    return null
  }

  return {
    question: currentQuestion.question,
    suggestions: validSuggestions,
    allowOther: currentQuestion.allowOther !== false,
    source: 'askQuestion',
    toolResult: toolCall.result,
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
