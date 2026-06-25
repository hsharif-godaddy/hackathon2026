import { describe, it, expect } from 'vitest'
import type { StreamMessageEvents } from '@airo-care/client'
import { translateCareEvent, terminalCompleteEvent } from '../translator.js'
import { CARE_REPORTED_ERROR } from '../errors.js'

const ctx = { agentName: 'support', conversationId: 'aab-1' }

function ev<T extends StreamMessageEvents>(e: T): T { return e }

describe('translateCareEvent', () => {
  it('maps delta to a chunk', () => {
    const out = translateCareEvent(ev({ eventId: 1, timestamp: 1, type: 'delta', textDelta: 'hi' }), ctx)
    expect(out).toEqual({
      type: 'chunk', content: 'hi', data: {},
      agentName: 'support', conversationId: 'aab-1',
    })
  })

  it('maps result to a complete with finishReason=stop', () => {
    const out = translateCareEvent(ev({ eventId: 2, timestamp: 2, type: 'result', output: 'done' }), ctx)
    expect(out).toEqual({
      type: 'complete', content: '', data: { finishReason: 'stop' },
      agentName: 'support', conversationId: 'aab-1',
    })
  })

  it('maps error to the controlled CARE_REPORTED_ERROR string (not event.message)', () => {
    const out = translateCareEvent(ev({
      eventId: 3, timestamp: 3, type: 'error', message: 'upstream timed out', fatal: true,
    }), ctx)
    expect(out?.type).toBe('chunk')
    // Must use the bounded constant, not the raw Care diagnostic message
    expect((out as { content: string }).content).toBe(CARE_REPORTED_ERROR)
    expect((out as { content: string }).content).not.toContain('upstream timed out')
    expect((out as { agentName: string }).agentName).toBe('support')
  })

  it('maps error to the controlled CARE_REPORTED_ERROR string when event.message is absent', () => {
    const out = translateCareEvent(
      { eventId: 3, timestamp: 3, type: 'error' } as unknown as StreamMessageEvents,
      ctx,
    )
    expect(out?.type).toBe('chunk')
    expect((out as { content: string }).content).toBe(CARE_REPORTED_ERROR)
  })

  it.each(['start', 'progress', 'heartbeat', 'data', 'artifact'] as const)(
    'returns null for %s events',
    (eventType) => {
      const e = { eventId: 4, timestamp: 4, type: eventType } as unknown as StreamMessageEvents
      expect(translateCareEvent(e, ctx)).toBeNull()
    },
  )
})

describe('terminalCompleteEvent', () => {
  it('returns a complete frame with finishReason=stop by default', () => {
    expect(terminalCompleteEvent(ctx)).toEqual({
      type: 'complete', content: '', data: { finishReason: 'stop' },
      agentName: 'support', conversationId: 'aab-1',
    })
  })

  it('returns a complete frame with finishReason=stop when explicitly passed "stop"', () => {
    expect(terminalCompleteEvent(ctx, 'stop')).toEqual({
      type: 'complete', content: '', data: { finishReason: 'stop' },
      agentName: 'support', conversationId: 'aab-1',
    })
  })

  it('returns a complete frame with finishReason=error when passed "error"', () => {
    expect(terminalCompleteEvent(ctx, 'error')).toEqual({
      type: 'complete', content: '', data: { finishReason: 'error' },
      agentName: 'support', conversationId: 'aab-1',
    })
  })
})
