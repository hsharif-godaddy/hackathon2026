import type { StreamingEvent } from './interfaces.js'
import { getCoalesceKey, mergeCoalescedData } from './interfaces.js'

/**
 * Coalesce consecutive coalesceable events in an array.
 * Used for recovery replay so the client sees the same delivery pattern
 * as live streaming with coalescing enabled.
 *
 * Non-coalesceable events pass through unchanged.
 * Coalesced events use the last event's metadata with merged content/data.
 * tool_input_delta events merge data.delta and match on toolId.
 */
export function coalesceEvents(events: StreamingEvent[]): StreamingEvent[] {
  if (events.length === 0) return []

  const result: StreamingEvent[] = []
  let pending: StreamingEvent | null = null
  let pendingKey: string | null = null

  for (const event of events) {
    const key = getCoalesceKey(event.type, event.data)

    if (key === null) {
      if (pending) {
        result.push(pending)
        pending = null
        pendingKey = null
      }
      result.push(event)
      continue
    }

    if (pending && pendingKey === key) {
      pending = {
        ...event,
        content: pending.content + event.content,
        data: mergeCoalescedData(event.type, pending.data, event.data)
      }
    } else {
      if (pending) {
        result.push(pending)
      }
      pending = { ...event }
      pendingKey = key
    }
  }

  if (pending) {
    result.push(pending)
  }

  return result
}
