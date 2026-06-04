/**
 * Pure helpers for normalizing/merging backend conversation payloads into the
 * shapes the chat store uses. Extracted from useStreamingConversationStore.ts;
 * no store dependency. The public ones are re-exported from the store to
 * preserve the import surface.
 */

import { createValidationToolCall, parseValidationStatus } from '@/stores/validationToolCall'
import type { AgentConversationMessagePayload, AgentSegmentPayload, AgentToolCallPayload } from '@/types/agent-conversation'
import type { ChatMessage, StreamSegment, ToolCall } from './useStreamingConversationStore.types'

// Helper function to generate unique IDs
export const generateId = () => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

const parseDateValue = (value: unknown, fallback: Date | number = Date.now()): Date => {
  if (!value) return new Date(fallback)
  const date = new Date(value as string | number | Date)
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date
}

const normalizeToolCall = (toolCall?: AgentToolCallPayload): ToolCall | undefined => {
  if (!toolCall) return undefined

  return {
    id: toolCall.id ?? generateId(),
    name: toolCall.name ?? toolCall.toolName ?? 'unknown-tool',
    input: toolCall.input ?? toolCall.toolArgs ?? {},
    result: toolCall.result ?? toolCall.toolResult,
    status: (toolCall.status ?? 'running') as ToolCall['status'],
    error: toolCall.error,
    startTime: toolCall.startTime,
    endTime: toolCall.endTime,
    duration: toolCall.duration ?? toolCall.durationMs,
    partialInput: toolCall.partialInput ?? toolCall.partial_input
  }
}

const normalizeSegments = (
  segments: AgentSegmentPayload[] | undefined,
  fallbackDate: Date
): StreamSegment[] => {
  if (!Array.isArray(segments)) return []

  return segments.map((segment) => {
    const normalizedToolCall = normalizeToolCall(segment.toolCall ?? segment.tool_call)

    return {
      id: segment.id ?? `${generateId()}_segment`,
      type: (segment.type ?? 'text') as StreamSegment['type'],
      content: segment.content ?? '',
      timestamp: parseDateValue(segment.timestamp ?? segment.createdAt, fallbackDate),
      ...(normalizedToolCall ? { toolCall: normalizedToolCall } : {})
    }
  })
}

const normalizeToolCalls = (toolCalls: AgentToolCallPayload[] | undefined): ToolCall[] => {
  if (!Array.isArray(toolCalls)) return []

  return toolCalls
    .map((toolCall) => normalizeToolCall(toolCall))
    .filter((toolCall): toolCall is ToolCall => Boolean(toolCall))
}

function isValidationPayload(msg: AgentConversationMessagePayload): boolean {
  return msg.metadata?.source === 'post_stream_validator' && msg.metadata?.displayAs === 'validation'
}

// Server-side conversation-persistence.ts writes the turn's abort reason onto
// `metadata.finalResult.finishReason`. The shape is opaque (`Record<string,
// unknown>`) on the wire, so peel it open carefully.
function extractUserStopped(metadata: Record<string, unknown> | undefined): boolean {
  const finalResult = metadata?.finalResult
  if (typeof finalResult !== 'object' || finalResult === null) return false
  const finishReason = (finalResult as Record<string, unknown>).finishReason
  return finishReason === 'user_stopped'
}

function extractToolCallsFromSegments(segments: StreamSegment[]): ToolCall[] {
  return segments
    .map((segment) => segment.toolCall)
    .filter((toolCall): toolCall is ToolCall => Boolean(toolCall))
}

function appendValidationToAssistant(message: ChatMessage, msg: AgentConversationMessagePayload, timestamp: Date): ChatMessage {
  const toolCall = createValidationToolCall({
    id: msg.id ?? `validation_${generateId()}`,
    status: parseValidationStatus(msg.metadata?.validationStatus),
    diagnostics: msg.content ?? ''
  })
  const textSegments: StreamSegment[] = message.segments?.length
    ? message.segments
    : message.content
      ? [{
        id: `${message.id}_content`,
        type: 'text',
        content: message.content,
        timestamp: message.timestamp
      }]
      : []
  const existingToolCalls = message.toolCalls?.length
    ? message.toolCalls
    : extractToolCallsFromSegments(textSegments)

  return {
    ...message,
    segments: dedupeSegmentsByToolId([
      ...textSegments,
      {
        id: `${toolCall.id}_segment`,
        type: 'tool_call',
        content: msg.content ?? '',
        timestamp,
        toolCall
      }
    ]),
    toolCalls: dedupeToolCallsById([...existingToolCalls, toolCall])
  }
}

// Merge later toolCall data over earlier, but never overwrite a populated
// field with `undefined`. The chronological "later is more complete"
// assumption usually holds (completed status + result arrives after running)
// but a sparser later entry must not strip a populated `result` / `endTime`
// off the earlier one.
export function mergeToolCallData<T extends object>(existing: T, incoming: T): T {
  const merged = { ...existing } as Record<string, unknown>
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as T
}

function dedupeSegmentsByToolId(segments: StreamSegment[]): StreamSegment[] {
  const result: StreamSegment[] = []
  const indexById = new Map<string, number>()
  for (const segment of segments) {
    const toolId = segment.toolCall?.id
    if (toolId === undefined) {
      result.push(segment)
      continue
    }
    const existingIndex = indexById.get(toolId)
    if (existingIndex !== undefined) {
      // First-seen position wins; later toolCall data wins per field.
      const existing = result[existingIndex]!
      const mergedToolCall = existing.toolCall
        ? mergeToolCallData(existing.toolCall, segment.toolCall!)
        : segment.toolCall
      result[existingIndex] = { ...existing, toolCall: mergedToolCall }
      continue
    }
    indexById.set(toolId, result.length)
    result.push(segment)
  }
  return result
}

function dedupeToolCallsById(toolCalls: ToolCall[]): ToolCall[] {
  const result: ToolCall[] = []
  const indexById = new Map<string, number>()
  for (const toolCall of toolCalls) {
    const existingIndex = indexById.get(toolCall.id)
    if (existingIndex !== undefined) {
      result[existingIndex] = mergeToolCallData(result[existingIndex]!, toolCall)
      continue
    }
    indexById.set(toolCall.id, result.length)
    result.push(toolCall)
  }
  return result
}

function getRenderableSegments(message: ChatMessage): StreamSegment[] {
  if (message.segments?.length) return message.segments
  if (!message.content) return []

  return [{
    id: `${message.id}_content`,
    type: 'text',
    content: message.content,
    timestamp: message.timestamp
  }]
}

function mergeAssistantMessages(previous: ChatMessage, next: ChatMessage): ChatMessage {
  const previousSegments = getRenderableSegments(previous)
  const nextSegments = getRenderableSegments(next)
  const previousToolCalls = previous.toolCalls?.length
    ? previous.toolCalls
    : extractToolCallsFromSegments(previousSegments)
  const nextToolCalls = next.toolCalls?.length
    ? next.toolCalls
    : extractToolCallsFromSegments(nextSegments)

  return {
    ...previous,
    content: [previous.content, next.content].filter(Boolean).join('\n\n'),
    segments: dedupeSegmentsByToolId([...previousSegments, ...nextSegments]),
    toolCalls: dedupeToolCallsById([...previousToolCalls, ...nextToolCalls]),
    commitHash: next.commitHash ?? previous.commitHash,
    maxStepsReached: previous.maxStepsReached || next.maxStepsReached,
    outputTokenLimitReached: previous.outputTokenLimitReached || next.outputTokenLimitReached,
    connectionLost: previous.connectionLost || next.connectionLost,
    userStopped: previous.userStopped || next.userStopped,
    upstreamError: previous.upstreamError || next.upstreamError,
    budgetExceeded: previous.budgetExceeded || next.budgetExceeded,
    usedFreeGrants: previous.usedFreeGrants || next.usedFreeGrants,
    error: previous.error ?? next.error,
    errorType: previous.errorType ?? next.errorType,
    errorCode: previous.errorCode ?? next.errorCode,
    retryAttempts: previous.retryAttempts ?? next.retryAttempts,
    retryReason: previous.retryReason ?? next.retryReason,
    metadata: {
      ...previous.metadata,
      ...next.metadata
    }
  }
}

/**
 * Normalize backend conversation payloads into the shape the chat UI expects.
 */
export const normalizeConversationMessages = (
  rawMessages: AgentConversationMessagePayload[] | undefined
): ChatMessage[] => {
  if (!Array.isArray(rawMessages)) return []

  let mergeNextAssistantIntoPrevious = false

  return rawMessages.reduce<ChatMessage[]>((messages, msg) => {
    const role = msg.sender === 'user' || msg.role === 'user' ? 'user' : 'assistant'
    const createdAtValue = msg.createdAt ?? msg.timestamp ?? Date.now()
    const createdAtDate = parseDateValue(createdAtValue)

    if (isValidationPayload(msg)) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'assistant') {
        messages[messages.length - 1] = appendValidationToAssistant(lastMessage, msg, createdAtDate)
        mergeNextAssistantIntoPrevious = true
        return messages
      }
    }

    const normalizedSegments = normalizeSegments(msg.segments, createdAtDate)
    const normalizedToolCalls = normalizeToolCalls(msg.toolCalls ?? msg.tool_calls)

    const normalizedMessage: ChatMessage = {
      id: msg.id ?? generateId(),
      role,
      content: msg.content ?? '',
      timestamp: createdAtDate,
      toolCalls: normalizedToolCalls,
      segments: normalizedSegments,
      metadata: msg.metadata,
      maxStepsReached: msg.maxStepsReached ?? (
        typeof msg.metadata?.maxStepsReached === 'boolean'
          ? msg.metadata.maxStepsReached
          : undefined
      ),
      usedFreeGrants: msg.usedFreeGrants ?? (
        typeof msg.metadata?.usedFreeGrants === 'boolean'
          ? msg.metadata.usedFreeGrants
          : undefined
      ),
      commitHash: typeof msg.metadata?.commitHash === 'string'
        ? msg.metadata.commitHash
        : undefined,
      // Recover the user-stopped flag from persisted metadata so Undo works
      // identically before and after a page reload. The server records the
      // abort reason on `metadata.finalResult.finishReason` (see agents
      // conversation-persistence.ts) when the user clicks Stop. Without this,
      // a refreshed transcript drops the flag and useUndoAction's user-stopped
      // squash inference can't fire.
      userStopped: extractUserStopped(msg.metadata) || undefined,
      upstreamError: msg.upstreamError,
      budgetExceeded: msg.budgetExceeded,
      error: msg.error,
      errorType: msg.errorType,
      errorCode: msg.errorCode,
      retryAttempts: msg.retryAttempts,
      retryReason: msg.retryReason,
      origin: msg.origin
    }

    if (mergeNextAssistantIntoPrevious && normalizedMessage.role === 'assistant') {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'assistant') {
        messages[messages.length - 1] = mergeAssistantMessages(lastMessage, normalizedMessage)
        mergeNextAssistantIntoPrevious = false
        return messages
      }
    }

    mergeNextAssistantIntoPrevious = false
    messages.push(normalizedMessage)
    return messages
  }, [])
}
