import { describe, it, expect } from 'vitest'
import { coalesceEvents } from '../coalesce-events.js'
import type { StreamingEvent } from '../interfaces.js'

function event(type: string, content: string, sequence: number, data?: Record<string, unknown>): StreamingEvent {
  return {
    id: `evt-${sequence}`,
    conversationId: 'conv-1',
    sequence,
    type: type as any,
    content,
    data: data ?? { sequence },
    timestamp: new Date(),
    agentName: 'test'
  }
}

describe('coalesceEvents', () => {
  it('coalesces consecutive chunk events', () => {
    const events = [
      event('chunk', 'He', 1),
      event('chunk', 'llo', 2),
      event('chunk', ' world', 3)
    ]

    const result = coalesceEvents(events)

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('Hello world')
    expect(result[0].data.sequence).toBe(3)
  })

  it('does not coalesce non-coalesceable events', () => {
    const events = [
      event('tool_start', '', 1),
      event('tool_call', '{}', 2),
      event('tool_result', 'ok', 3)
    ]

    const result = coalesceEvents(events)
    expect(result).toHaveLength(3)
  })

  it('coalesces both chunks and tool_input_delta', () => {
    const events = [
      event('chunk', 'a', 1),
      event('chunk', 'b', 2),
      event('tool_start', '', 3),
      event('tool_input_delta', '', 4, { toolId: 't1', delta: '{"x' }),
      event('tool_input_delta', '', 5, { toolId: 't1', delta: '":1}' }),
      event('tool_call', '{"x":1}', 6),
      event('chunk', 'c', 7),
      event('chunk', 'd', 8)
    ]

    const result = coalesceEvents(events)

    expect(result).toHaveLength(5)
    expect(result[0].content).toBe('ab')             // chunks coalesced
    expect(result[1].type).toBe('tool_start')
    expect(result[2].type).toBe('tool_input_delta')
    expect(result[2].data.delta).toBe('{"x":1}')     // deltas coalesced
    expect(result[2].data.toolId).toBe('t1')
    expect(result[3].type).toBe('tool_call')
    expect(result[4].content).toBe('cd')             // chunks coalesced
  })

  it('does not coalesce tool_input_delta with different toolIds', () => {
    const events = [
      event('tool_input_delta', '', 1, { toolId: 't1', delta: 'aaa' }),
      event('tool_input_delta', '', 2, { toolId: 't2', delta: 'bbb' })
    ]

    const result = coalesceEvents(events)
    expect(result).toHaveLength(2)
    expect(result[0].data.delta).toBe('aaa')
    expect(result[1].data.delta).toBe('bbb')
  })

  it('returns empty array for empty input', () => {
    expect(coalesceEvents([])).toEqual([])
  })

  it('handles single event', () => {
    const result = coalesceEvents([event('chunk', 'solo', 1)])
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('solo')
  })

  it('handles empty content strings in coalesceable events', () => {
    const events = [
      event('chunk', '', 1),
      event('chunk', 'hello', 2),
      event('chunk', '', 3)
    ]

    const result = coalesceEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('hello')
  })

  it('handles tool_input_delta with missing delta field', () => {
    const events = [
      event('tool_input_delta', '', 1, { toolId: 't1' }),
      event('tool_input_delta', '', 2, { toolId: 't1', delta: 'hello' })
    ]

    const result = coalesceEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].data.delta).toBe('hello') // '' + 'hello'
  })
})
