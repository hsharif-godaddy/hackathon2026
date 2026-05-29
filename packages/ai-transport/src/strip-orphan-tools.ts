export interface StrippedToolMessage {
  role: 'tool'
  tool_call_id?: string
  [k: string]: unknown
}

/**
 * Strip leading tool-role messages that appear before any assistant message.
 * Orphaned tool results violate the Anthropic API contract (tool results must
 * follow an assistant message containing the corresponding tool_call).
 *
 * Mutates the array in-place for efficiency (avoids allocation on the hot path).
 * Returns the removed messages so callers can log tool_call_ids.
 */
export function stripLeadingOrphanTools(messages: Array<{ role: string; [k: string]: unknown }>): StrippedToolMessage[] {
  const removed: StrippedToolMessage[] = []
  while (messages.length > 0 && messages[0]?.role === 'tool') {
    removed.push(messages.shift() as StrippedToolMessage)
  }
  return removed
}
