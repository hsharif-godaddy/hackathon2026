import { describe, expect, it } from 'vitest'
import {
  extractTurnOutputFromEvents,
  trackTurnSnapshotEvent,
  buildToolResponseData,
  extractTurnToolResponseDataFromEvents,
  buildInvocationToolResponseData,
  type TurnSnapshotState,
} from '../turn-snapshot-tracker.js'

describe('trackTurnSnapshotEvent', () => {
  it('captures streaming events and does not separate consecutive text chunks', () => {
    const state: TurnSnapshotState = { streamingEvents: [] }

    trackTurnSnapshotEvent(state, 'chunk', 'Hello ', {})
    const result = trackTurnSnapshotEvent(state, 'chunk', 'World', {})

    expect(state.streamingEvents).toHaveLength(2)
    expect(result.update.content).toBe('Hello World')
    expect(result.shouldUpdateAgentTurn).toBe(false)
  })

  it('inserts a newline when text resumes after a non-text event', () => {
    const state: TurnSnapshotState = { streamingEvents: [] }

    trackTurnSnapshotEvent(state, 'chunk', 'Hello', {})
    trackTurnSnapshotEvent(state, 'tool_result', '', { tool: { id: 'search', name: 'search', output: 'ok' } })
    const result = trackTurnSnapshotEvent(state, 'chunk', 'World', {})

    expect(result.update.content).toBe('Hello\nWorld')
  })

  it('tracks successful tool results for incremental agent-turn updates', () => {
    const state: TurnSnapshotState = { streamingEvents: [] }

    trackTurnSnapshotEvent(state, 'chunk', 'Before tool. ', {})
    trackTurnSnapshotEvent(state, 'tool_start', '', { tool: { id: 'tid1', name: 'myTool', input: {} } })
    const result = trackTurnSnapshotEvent(state, 'tool_result', '', {
      tool: { id: 'tid1', name: 'myTool', input: { k: 'v' }, output: 'done' },
    })

    expect(result.shouldUpdateAgentTurn).toBe(true)
    expect(result.update.content).toBe('Before tool. ')
    expect(result.update.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tid1',
        name: 'myTool',
        input: { k: 'v' },
        result: 'done',
        status: 'completed',
      }),
    ])
    expect(result.update.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'content', content: 'Before tool. ' }),
      expect.objectContaining({
        type: 'tool_call',
        toolCall: expect.objectContaining({ id: 'tid1', status: 'completed' }),
      }),
    ]))
  })

  it('tracks tool errors for incremental agent-turn updates', () => {
    const state: TurnSnapshotState = { streamingEvents: [] }

    trackTurnSnapshotEvent(state, 'tool_start', '', { tool: { id: 'tid1', name: 'myTool', input: {} } })
    const result = trackTurnSnapshotEvent(state, 'tool_result', '', {
      tool: { id: 'tid1', name: 'myTool', input: { k: 'v' }, output: {}, error: 'boom', is_error: true },
    })

    expect(result.shouldUpdateAgentTurn).toBe(true)
    expect(result.update.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tid1',
        status: 'error',
        error: 'boom',
        result: {},
      }),
    ])
  })

  it('keeps multiple tool calls distinct when results arrive out of order', () => {
    const state: TurnSnapshotState = { streamingEvents: [] }

    trackTurnSnapshotEvent(state, 'tool_start', '', { tool: { id: 'tid1', name: 'first', input: {} } })
    trackTurnSnapshotEvent(state, 'tool_start', '', { tool: { id: 'tid2', name: 'second', input: {} } })
    trackTurnSnapshotEvent(state, 'tool_result', '', { tool: { id: 'tid2', name: 'second', output: 'two' } })
    const result = trackTurnSnapshotEvent(state, 'tool_result', '', { tool: { id: 'tid1', name: 'first', output: 'one' } })

    expect(result.update.toolCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tid1', name: 'first', result: 'one', status: 'completed' }),
      expect.objectContaining({ id: 'tid2', name: 'second', result: 'two', status: 'completed' }),
    ]))
    expect(result.update.segments.filter(segment => segment.type === 'tool_call')).toHaveLength(2)
  })

  it('creates a tool-call segment for tool_result without a prior tool_start', () => {
    const state: TurnSnapshotState = { streamingEvents: [] }

    const result = trackTurnSnapshotEvent(state, 'tool_result', '', {
      tool: { id: 'orphan', name: 'orphanTool', input: { q: 1 }, output: 'ok' },
    })

    expect(result.shouldUpdateAgentTurn).toBe(true)
    expect(result.update.toolCalls).toEqual([
      expect.objectContaining({ id: 'orphan', name: 'orphanTool', input: { q: 1 }, result: 'ok' }),
    ])
    expect(result.update.segments).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        toolCall: expect.objectContaining({ id: 'orphan', status: 'completed' }),
      }),
    ])
  })
})

describe('extractTurnOutputFromEvents', () => {
  it('accumulates chunk text across handoff iterations', () => {
    const events = [
      { type: 'chunk', content: 'From develop. ', timestamp: new Date() },
      { type: 'tool_result', content: '', data: {}, timestamp: new Date() },
      { type: 'chunk', content: 'From marketing.', timestamp: new Date() },
    ]

    expect(extractTurnOutputFromEvents(events)).toBe('From develop. \nFrom marketing.')
  })
})

describe('buildToolResponseData', () => {
  it('maps completed tool calls to observability responseData', () => {
    const data = buildToolResponseData([
      { id: 't1', name: 'edit_file', input: {}, status: 'completed', startTime: new Date(), result: 'ok' },
    ])
    expect(data).toEqual([{ name: 'edit_file', status: 'completed', output: 'ok' }])
  })

  it('returns undefined when there are no tool calls', () => {
    expect(buildToolResponseData([])).toBeUndefined()
  })
})

describe('extractTurnToolResponseDataFromEvents', () => {
  it('accumulates tool results across handoff iterations', () => {
    const events = [
      { type: 'tool_start', content: '', data: { tool: { id: 'a', name: 'first', input: {} } }, timestamp: new Date() },
      { type: 'tool_result', content: '', data: { tool: { id: 'a', name: 'first', output: 'one' } }, timestamp: new Date() },
      { type: 'tool_start', content: '', data: { tool: { id: 'b', name: 'second', input: {} } }, timestamp: new Date() },
      { type: 'tool_result', content: '', data: { tool: { id: 'b', name: 'second', output: 'two' } }, timestamp: new Date() },
    ]

    expect(extractTurnToolResponseDataFromEvents(events)).toEqual([
      { name: 'first', status: 'completed', output: 'one' },
      { name: 'second', status: 'completed', output: 'two' },
    ])
  })
})

describe('buildInvocationToolResponseData', () => {
  it('returns only tools added during the current invocation', () => {
    const snapshot: TurnSnapshotState = { streamingEvents: [] }
    trackTurnSnapshotEvent(snapshot, 'tool_start', '', { tool: { id: 'old', name: 'oldTool', input: {} } })
    trackTurnSnapshotEvent(snapshot, 'tool_result', '', { tool: { id: 'old', name: 'oldTool', output: 'prior' } })
    const before = new Set(snapshot.pendingToolCalls?.keys() ?? [])
    trackTurnSnapshotEvent(snapshot, 'tool_start', '', { tool: { id: 'new', name: 'newTool', input: {} } })
    trackTurnSnapshotEvent(snapshot, 'tool_result', '', { tool: { id: 'new', name: 'newTool', output: 'fresh' } })

    expect(buildInvocationToolResponseData(snapshot, before)).toEqual([
      { name: 'newTool', status: 'completed', output: 'fresh' },
    ])
  })
})
