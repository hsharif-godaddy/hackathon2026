import { describe, expect, it } from 'vitest'

import { deriveSubAgentLifecycle, parseSubagentOutputs, type SubAgentEventLike } from './subagentStatus'

function ev(event: string, detail = ''): SubAgentEventLike {
  return { event, detail }
}

describe('parseSubagentOutputs', () => {
  it('returns undefined when no outputs event is present', () => {
    expect(parseSubagentOutputs([ev('started'), ev('progress')])).toBeUndefined()
  })

  it('parses the outputs event JSON detail', () => {
    const detail = JSON.stringify({ status: 'success', summary: 'done', artifacts: ['a.ts'] })
    const out = parseSubagentOutputs([ev('started'), ev('outputs', detail)])
    expect(out).toEqual({ status: 'success', summary: 'done', artifacts: ['a.ts'] })
  })

  it('returns the last outputs event when several exist', () => {
    const out = parseSubagentOutputs([
      ev('outputs', JSON.stringify({ status: 'error' })),
      ev('outputs', JSON.stringify({ status: 'success' })),
    ])
    expect(out?.status).toBe('success')
  })

  it('returns undefined on malformed JSON', () => {
    expect(parseSubagentOutputs([ev('outputs', 'not json')])).toBeUndefined()
  })
})

describe('deriveSubAgentLifecycle', () => {
  it('is running while only progress events have arrived, even when the tool call completed', () => {
    expect(deriveSubAgentLifecycle([ev('started'), ev('tool_call'), ev('progress')], 'completed')).toBe('running')
  })

  it('is running with no events and a completed dispatch', () => {
    expect(deriveSubAgentLifecycle([], 'completed')).toBe('running')
  })

  it('reports success from the outputs event', () => {
    const detail = JSON.stringify({ status: 'success' })
    expect(deriveSubAgentLifecycle([ev('progress'), ev('outputs', detail)], 'completed')).toBe('success')
  })

  it('reports error from the outputs event', () => {
    const detail = JSON.stringify({ status: 'error' })
    expect(deriveSubAgentLifecycle([ev('outputs', detail)], 'completed')).toBe('error')
  })

  it('falls back to a completed event when outputs is absent', () => {
    expect(deriveSubAgentLifecycle([ev('completed', 'all done')], 'completed')).toBe('success')
  })

  it('falls back to an error event when outputs is absent', () => {
    expect(deriveSubAgentLifecycle([ev('error', 'boom')], 'running')).toBe('error')
  })

  it('treats a failed dispatch (tool error, no events) as error', () => {
    expect(deriveSubAgentLifecycle([], 'error')).toBe('error')
  })

  it('reports a distinct aborted lifecycle from the outputs event', () => {
    const detail = JSON.stringify({ status: 'aborted' })
    expect(deriveSubAgentLifecycle([ev('outputs', detail)], 'completed')).toBe('aborted')
  })

  it('falls back to the persisted awaitAgents status when events are gone (reload)', () => {
    expect(deriveSubAgentLifecycle([], 'completed', 'success')).toBe('success')
    expect(deriveSubAgentLifecycle([], 'completed', 'error')).toBe('error')
    expect(deriveSubAgentLifecycle([], 'completed', 'aborted')).toBe('aborted')
    expect(deriveSubAgentLifecycle([], 'completed', 'running')).toBe('running')
    expect(deriveSubAgentLifecycle([], 'completed', 'queued')).toBe('running')
  })

  it('prefers a live terminal event over the awaitAgents status', () => {
    const detail = JSON.stringify({ status: 'success' })
    expect(deriveSubAgentLifecycle([ev('outputs', detail)], 'completed', 'error')).toBe('success')
  })

  it('prefers the outputs status over a stray error event', () => {
    const detail = JSON.stringify({ status: 'success' })
    expect(deriveSubAgentLifecycle([ev('error', 'transient'), ev('outputs', detail)], 'completed')).toBe('success')
  })
})
