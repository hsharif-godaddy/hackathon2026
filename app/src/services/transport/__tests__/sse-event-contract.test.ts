/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { STREAMING_EVENT_TYPES } from '@airo/ai-transport/event-types'

import {
  ROUTE_EVENT_TYPES,
  SSE_INTENTIONALLY_IGNORED,
  SSE_REGISTERED_EVENT_TYPES,
} from '../SSETransport'

describe('SSE event contract', () => {
  it('production registers or explicitly ignores every server event type', () => {
    const registered = new Set(SSE_REGISTERED_EVENT_TYPES)
    const unhandled = STREAMING_EVENT_TYPES.filter(
      (t) => !registered.has(t) && !SSE_INTENTIONALLY_IGNORED.has(t),
    )
    expect(unhandled).toEqual([])
  })

  it('intentionally ignored events are all valid server types', () => {
    const invalid = [...SSE_INTENTIONALLY_IGNORED].filter(
      (t) => !(STREAMING_EVENT_TYPES as readonly string[]).includes(t),
    )
    expect(invalid).toEqual([])
  })

  it('route event types are not duplicates of streaming event types', () => {
    const duplicates = ROUTE_EVENT_TYPES.filter((t) =>
      (STREAMING_EVENT_TYPES as readonly string[]).includes(t),
    )
    expect(duplicates).toEqual([])
  })
})
