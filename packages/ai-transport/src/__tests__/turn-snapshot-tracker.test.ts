import { describe, expect, it } from 'vitest'
import { trackTurnSnapshotEvent, type TurnSnapshotState } from '../turn-snapshot-tracker.js'

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
