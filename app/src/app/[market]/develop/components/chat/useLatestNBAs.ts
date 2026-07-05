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
 * True when the latest assistant message parked on an unanswered `askQuestion`
 * NBA (the model asked a question and is waiting for the user to answer or skip).
 *
 * Used to keep an interview turn from being treated as a completed first build:
 * the kit-attach interview turn commits its forced-install tokens (connection-end
 * git hook), so the SSE `complete` event carries a commitHash that would otherwise
 * optimistically flip the client `initialBuildComplete` → activate First Build
 * Feedback → suppress this very interview card (AIROBUILD-2665). Reuses
 * `extractLatestNBAFromMessages` (which already returns null once a user answer
 * follows via `hasNbaResponseAfter`).
 */
export function isParkedOnAskQuestion(messages: ChatMessage[]): boolean {
  const nba = extractLatestNBAFromMessages(messages)
  return nba?.source === 'askQuestion'
}

const CHARGE_CONFIRM_WIDGET_TYPE = 'compliance-charge-confirm'

// Detect the charge dialog by its widget, NOT the tool name — robust to which
// tool emits it (request_charge_confirmation today) and to skill-prefix changes.
function isChargeConfirmWidget(result: ToolCall['result']): boolean {
  if (!result || typeof result !== 'object') return false
  const r = result as { output?: Record<string, unknown> } & Record<string, unknown>
  const output = (r.output ?? r) as { widgetType?: unknown; widgetData?: { documentType?: unknown; showCost?: unknown } }
  if (output?.widgetType === CHARGE_CONFIRM_WIDGET_TYPE) return true
  // Fallback in case widgetType is dropped from the persisted result: the dialog's
  // widgetData carries a documentType and a showCost flag (what the renderer needs).
  const wd = output?.widgetData
  return typeof wd?.documentType === 'string' && typeof wd?.showCost === 'boolean'
}

function toolCallsHavePendingChargeConfirmation(toolCalls: ToolCall[] | undefined): boolean {
  if (!toolCalls?.length) return false
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const toolCall = toolCalls[i]
    if (toolCall.status !== 'completed' || !toolCall.result) continue
    if (isChargeConfirmWidget(toolCall.result)) return true
  }
  return false
}

/**
 * True while the latest assistant turn is parked on an unanswered compliance
 * charge-confirmation dialog (the Accept/Cancel prompt), so next-action
 * suggestions stay suppressed until the user decides.
 *
 * The active stream IS the current turn: if its latest tool is the confirmation
 * widget, the user hasn't acted yet (Accept/Cancel sends a new message and starts
 * a fresh stream). We must NOT reuse the askQuestion-style `hasNbaResponseAfter`
 * check here — the compliance flow's earlier askQuestion answers are themselves
 * `isActionRequest` messages and would falsely read as "answered". The
 * history-based check applies only once the turn has settled into `messages`.
 */
export function useAwaitingChargeConfirmation(): boolean {
  const messages = useMessages()
  const activeStream = useActiveStream()

  return useMemo(() => {
    if (activeStream?.toolCalls && toolCallsHavePendingChargeConfirmation(activeStream.toolCalls)) {
      return true
    }

    const lastAssistantIndex = findLastAssistantIndex(messages)
    if (lastAssistantIndex < 0) return false
    if (!toolCallsHavePendingChargeConfirmation(messages[lastAssistantIndex].toolCalls)) return false
    return !hasNbaResponseAfter(messages, lastAssistantIndex)
  }, [messages, activeStream])
}

/**
 * Hook that extracts the latest NBA (suggested response) data from conversation messages.
 * Returns null when no NBA data is available, or when feedbackActive is true.
 */
export function useLatestNBAs(feedbackActive = false): LatestNBAData | null {
  const messages = useMessages()
  const activeStream = useActiveStream()
  const resolvedSecretsComposerToolCallIds = useStreamingConversationStore(
    (state) => state.resolvedSecretsComposerToolCallIds,
  )

  return useMemo(() => {
    if (feedbackActive) return null

    if (
      activeStream?.toolCalls?.length &&
      pickLatestUnresolvedFromToolCalls(activeStream.toolCalls, resolvedSecretsComposerToolCallIds)
    ) {
      return null
    }

    // Stop-after tools (askQuestion/suggestedResponse) park the stream as active but
    // not complete while awaiting the user. A completed NBA tool call in that stream is
    // the live question — surface it. It can't have been consumed yet, or the stream
    // would have resumed. extractLatestNBAFromToolCalls returns null for a genuinely
    // mid-stream stream (no completed NBA tool), preserving suppression there.
    if (activeStream && !activeStream.isComplete) {
      return extractLatestNBAFromToolCalls(activeStream.toolCalls ?? [])
    }

    const lastAssistantIndex = findLastAssistantIndex(messages)
    const nbaConsumed = hasNbaResponseAfter(messages, lastAssistantIndex)

    if (activeStream?.isComplete && activeStream.toolCalls) {
      const nba = extractLatestNBAFromToolCalls(activeStream.toolCalls)
      if (nba) return nbaConsumed ? null : nba
    }

    return extractLatestNBAFromMessages(messages)
  }, [messages, activeStream, feedbackActive, resolvedSecretsComposerToolCallIds])
}
