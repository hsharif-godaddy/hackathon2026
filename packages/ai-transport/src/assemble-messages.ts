import { stripLeadingOrphanTools } from './strip-orphan-tools.js'

/**
 * Extract the textual content of a message for prompt comparison. Returns the
 * string directly, or concatenates the `text` of AI SDK content parts.
 */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('')
  }
  return ''
}

/**
 * Drop the trailing history message when it is the current turn's user prompt.
 *
 * The current message is persisted before history is loaded, so it comes back
 * as the last history entry AND is appended again as the prompt by the caller —
 * this removes that single trailing copy. Only the last element is considered,
 * so genuine cross-turn repeats are left intact. Returns the input array
 * unchanged (same reference) when there is nothing to drop.
 *
 * Exposed so callers can derive a correct `isFirstTurn` from the effective
 * (deduped) history, matching what gets assembled.
 */
export function dropTrailingPrompt<T extends { role: string; content: unknown }>(
  conversationHistory: T[],
  currentPrompt?: string
): T[] {
  if (currentPrompt === undefined || conversationHistory.length === 0) {
    return conversationHistory
  }
  const last = conversationHistory[conversationHistory.length - 1]
  if (last && last.role === 'user' && messageText(last.content).trim() === currentPrompt.trim()) {
    return conversationHistory.slice(0, -1)
  }
  return conversationHistory
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type InsertionOrder = 'before_history' | 'after_history'

export interface ContextMessage {
  role: string
  content: unknown
  insertionOrder?: InsertionOrder | string
  cachePoint?: { type: 'ephemeral' }
}

export interface HistoryMessage {
  role: string
  content: unknown
  cachePoint?: { type: 'ephemeral' }
  tool_calls?: unknown[]
}

export interface AssembleMessagesInput {
  /** Raw context messages from the context provider (before/after history mixed). */
  contextMessages: ContextMessage[]
  /** Conversation history loaded from persistence. */
  conversationHistory: HistoryMessage[]
  /** Extra messages to insert after history and after context's after_history messages (RAG, TODO, memory, etc). */
  extraAfterHistory?: Array<{ role: string; content: unknown; cachePoint?: { type: 'ephemeral' } }>
  /** Preflight tool-call pairs to inject (placed between history and after_history). */
  preflightMessages?: Array<{ role: string; content: unknown }>
  /**
   * The current turn's prompt. The caller appends this as the final user message
   * after assembly, so if conversation history already ends with it (persisted
   * before history load) we drop that trailing copy to avoid sending it twice.
   */
  currentPrompt?: string
}

export interface AssembleMessagesResult {
  /** Before-history context messages — passed as the `context` param to streamGenerate. */
  beforeHistory: Array<{ role: string; content: unknown; cachePoint?: { type: 'ephemeral' } }>
  /** Assembled messages array — history + preflight + afterHistory + extraAfterHistory. */
  messages: Array<{ role: string; content: unknown; cachePoint?: { type: 'ephemeral' }; tool_calls?: unknown[] }>
  /** Leading tool messages that were stripped (includes tool_call_id for logging). */
  strippedOrphanTools: Array<{ role: string; tool_call_id?: string; [k: string]: unknown }>
}

/**
 * Assemble the final message arrays for an LLM call. Shared between WS and SSE
 * transports to ensure identical message ordering and validation.
 *
 * Order: [...conversationHistory, ...preflightMessages, ...afterHistoryContext, ...extraAfterHistory]
 * Then: strip any leading orphan tool messages.
 */
export function assembleMessages(input: AssembleMessagesInput): AssembleMessagesResult {
  const { contextMessages, conversationHistory, extraAfterHistory, preflightMessages, currentPrompt } = input

  const beforeHistory: AssembleMessagesResult['beforeHistory'] = []
  const afterHistoryContext: Array<{ role: string; content: unknown; cachePoint?: { type: 'ephemeral' } }> = []

  for (const msg of contextMessages) {
    const converted = {
      role: msg.role,
      content: msg.content,
      ...(msg.cachePoint && { cachePoint: msg.cachePoint }),
    }
    if (msg.insertionOrder === 'before_history') {
      beforeHistory.push(converted)
    } else {
      afterHistoryContext.push(converted)
    }
  }

  const messages: AssembleMessagesResult['messages'] = []

  const history = dropTrailingPrompt(conversationHistory, currentPrompt)

  for (const msg of history) {
    const converted: AssembleMessagesResult['messages'][number] = {
      role: msg.role,
      content: msg.content,
      ...(msg.cachePoint && { cachePoint: msg.cachePoint }),
      ...(msg.role === 'assistant' && msg.tool_calls && { tool_calls: msg.tool_calls }),
    }
    messages.push(converted)
  }

  if (preflightMessages && preflightMessages.length > 0) {
    messages.push(...preflightMessages)
  }

  messages.push(...afterHistoryContext)

  if (extraAfterHistory && extraAfterHistory.length > 0) {
    messages.push(...extraAfterHistory)
  }

  const strippedOrphanTools = stripLeadingOrphanTools(messages)

  return { beforeHistory, messages, strippedOrphanTools: strippedOrphanTools }
}
