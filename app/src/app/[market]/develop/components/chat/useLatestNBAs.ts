import { useMemo } from 'react'

import { pickLatestUnresolvedFromToolCalls } from '@/app/[market]/develop/components/chat/secrets/resolveSecretsRequest'
import type { ChatMessage, ToolCall } from '@/stores/useStreamingConversationStore'
import { useActiveStream, useMessages, useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

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

  const currentIndex = widgetData.currentQuestionIndex ?? 0
  const currentQuestion = widgetData.questions[currentIndex]
  if (!currentQuestion?.question || !Array.isArray(currentQuestion.suggestions)) {
    return null
  }

  const validSuggestions = currentQuestion.suggestions.filter(
    (s: unknown): s is Suggestion => !!s && typeof (s as Suggestion).text === 'string'
  )

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

function findLastAssistantIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i
  }
  return -1
}

function hasNbaResponseAfter(messages: ChatMessage[], assistantIndex: number): boolean {
  if (assistantIndex < 0) return false
  return messages.slice(assistantIndex + 1).some(
    msg =>
      msg.role === 'user' &&
      (msg.metadata?.isActionRequest === true || msg.metadata?.askQuestionSkipped === true),
  )
}

function extractLatestNBAFromToolCalls(toolCalls: ToolCall[]): LatestNBAData | null {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const nba = extractNBAFromToolCall(toolCalls[i])
    if (nba) return nba
  }
  return null
}

function extractLatestNBAFromMessages(messages: ChatMessage[]): LatestNBAData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.toolCalls) {
      const nba = extractLatestNBAFromToolCalls(msg.toolCalls)
      if (nba) {
        if (hasNbaResponseAfter(messages, i)) return null
        return nba
      }
      break
    }
  }
  return null
}

/**
 * Hook that extracts the latest NBA (suggested response) data from conversation messages.
 * Returns null when no NBA data is available.
 */
export function useLatestNBAs(): LatestNBAData | null {
  const messages = useMessages()
  const activeStream = useActiveStream()
  const resolvedSecretsComposerToolCallIds = useStreamingConversationStore(
    (state) => state.resolvedSecretsComposerToolCallIds,
  )

  return useMemo(() => {
    if (
      activeStream?.toolCalls?.length &&
      pickLatestUnresolvedFromToolCalls(activeStream.toolCalls, resolvedSecretsComposerToolCallIds)
    ) {
      return null
    }

    if (activeStream && !activeStream.isComplete) {
      return null
    }

    const lastAssistantIndex = findLastAssistantIndex(messages)
    const nbaConsumed = hasNbaResponseAfter(messages, lastAssistantIndex)

    if (activeStream?.isComplete && activeStream.toolCalls) {
      const nba = extractLatestNBAFromToolCalls(activeStream.toolCalls)
      if (nba) return nbaConsumed ? null : nba
    }

    return extractLatestNBAFromMessages(messages)
  }, [activeStream, messages, resolvedSecretsComposerToolCallIds])
}
