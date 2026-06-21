import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventCoalescer, type CoalescerConfig, type CoalescedMessage } from '../event-coalescer.js'

interface WebSocketMessage {
  type: string
  content: string
  data: Record<string, unknown>
}

function msg(type: string, content: string, data: Record<string, unknown> = {}): WebSocketMessage {
  return { type: type as any, content, data }
}

describe('EventCoalescer', () => {
  let flushed: CoalescedMessage<WebSocketMessage>[][]
  let flushFn: (messages: CoalescedMessage<WebSocketMessage>[]) => void
  let coalescer: EventCoalescer<WebSocketMessage>

  beforeEach(() => {
    vi.useFakeTimers()
    flushed = []
    flushFn = (msgs) => flushed.push([...msgs])
    coalescer = new EventCoalescer<WebSocketMessage>(flushFn, { baseWindowMs: 30 })
  })

  afterEach(() => {
    coalescer.dispose()
    vi.useRealTimers()
  })

  describe('coalesceable events', () => {
    it('buffers consecutive chunk events and flushes on timer', () => {
      coalescer.push(msg('chunk', 'He'))
      coalescer.push(msg('chunk', 'llo'))
      coalescer.push(msg('chunk', ' world'))

      expect(flushed).toHaveLength(0)

      vi.advanceTimersByTime(30)

      expect(flushed).toHaveLength(1)
      expect(flushed[0]).toHaveLength(1)
      expect(flushed[0][0].content).toBe('Hello world')
      expect(flushed[0][0].type).toBe('chunk')
    })

    it('coalesces consecutive tool_input_delta by concatenating data.delta', () => {
      coalescer.push(msg('tool_input_delta', '', { toolId: 't1', delta: '{"na' }))
      coalescer.push(msg('tool_input_delta', '', { toolId: 't1', delta: 'me":' }))
      coalescer.push(msg('tool_input_delta', '', { toolId: 't1', delta: '"foo"}' }))

      vi.advanceTimersByTime(30)

      expect(flushed).toHaveLength(1)
      expect(flushed[0][0].data.delta).toBe('{"name":"foo"}')
      expect(flushed[0][0].data.toolId).toBe('t1')
      expect(flushed[0][0].content).toBe('') // content stays empty
    })

    it('does not coalesce tool_input_delta with different toolIds', () => {
      coalescer.push(msg('tool_input_delta', '', { toolId: 't1', delta: 'aaa' }))
      coalescer.push(msg('tool_input_delta', '', { toolId: 't2', delta: 'bbb' }))

      // Different toolId = different coalesce key → flush t1, buffer t2
      expect(flushed).toHaveLength(1)
      expect(flushed[0][0].data.toolId).toBe('t1')
      expect(flushed[0][0].data.delta).toBe('aaa')

      vi.advanceTimersByTime(30)
      expect(flushed).toHaveLength(2)
      expect(flushed[1][0].data.toolId).toBe('t2')
      expect(flushed[1][0].data.delta).toBe('bbb')
    })

    it('uses last event data for coalesced message', () => {
      coalescer.push(msg('chunk', 'a', { sequence: 1 }))
      coalescer.push(msg('chunk', 'b', { sequence: 2 }))
      coalescer.push(msg('chunk', 'c', { sequence: 3 }))

      vi.advanceTimersByTime(30)

      expect(flushed[0][0].data).toEqual({ sequence: 3 })
    })

    it('sets coalescedCount when multiple events merged', () => {
      coalescer.push(msg('chunk', 'a'))
      coalescer.push(msg('chunk', 'b'))
      coalescer.push(msg('chunk', 'c'))

      vi.advanceTimersByTime(30)

      expect(flushed[0][0].coalescedCount).toBe(3)
    })

    it('omits coalescedCount for single event', () => {
      coalescer.push(msg('chunk', 'solo'))

      vi.advanceTimersByTime(30)

      expect(flushed[0][0].coalescedCount).toBeUndefined()
    })

    it('coalesces chunks with empty content strings', () => {
      coalescer.push(msg('chunk', ''))
      coalescer.push(msg('chunk', 'hello'))
      coalescer.push(msg('chunk', ''))

      vi.advanceTimersByTime(30)

      expect(flushed[0][0].content).toBe('hello')
    })
  })

  describe('non-coalesceable events', () => {
    it('flushes pending buffer then passes through immediately', () => {
      coalescer.push(msg('chunk', 'Hello'))
      coalescer.push(msg('tool_start', '', { toolId: 't1' }))

      expect(flushed).toHaveLength(1)
      expect(flushed[0]).toHaveLength(2)
      expect(flushed[0][0].content).toBe('Hello')
      expect(flushed[0][1].type).toBe('tool_start')
    })

    it('passes lifecycle events through without delay', () => {
      coalescer.push(msg('step_start', '', { step: 1 }))

      expect(flushed).toHaveLength(1)
      expect(flushed[0][0].type).toBe('step_start')
    })
  })

  describe('terminal events', () => {
    it('flushes buffer and passes complete event immediately', () => {
      coalescer.push(msg('chunk', 'final text'))
      coalescer.push(msg('complete', '', { usage: {} }))

      expect(flushed).toHaveLength(1)
      expect(flushed[0]).toHaveLength(2)
      expect(flushed[0][0].content).toBe('final text')
      expect(flushed[0][1].type).toBe('complete')
    })

    it('flushes buffer and passes error event immediately', () => {
      coalescer.push(msg('chunk', 'partial'))
      coalescer.push(msg('error', 'something broke', { error: 'fail' }))

      expect(flushed).toHaveLength(1)
      expect(flushed[0][0].content).toBe('partial')
      expect(flushed[0][1].type).toBe('error')
    })
  })

  describe('type change between coalesceable types', () => {
    it('flushes chunk buffer when tool_input_delta arrives', () => {
      coalescer.push(msg('chunk', 'text'))
      coalescer.push(msg('tool_input_delta', '', { toolId: 't1', delta: '{"a' }))

      // chunk flushed due to different coalesce key
      expect(flushed).toHaveLength(1)
      expect(flushed[0]).toHaveLength(1)
      expect(flushed[0][0].content).toBe('text')

      // tool_input_delta now buffered
      vi.advanceTimersByTime(30)
      expect(flushed).toHaveLength(2)
      expect(flushed[1][0].data.delta).toBe('{"a')
    })
  })

  describe('flush', () => {
    it('flushes pending buffer without disabling the coalescer', () => {
      coalescer.push(msg('chunk', 'first'))
      coalescer.flush()

      expect(flushed).toHaveLength(1)
      expect(flushed[0][0].content).toBe('first')

      coalescer.push(msg('chunk', 'second'))
      vi.advanceTimersByTime(30)

      expect(flushed).toHaveLength(2)
      expect(flushed[1][0].content).toBe('second')
    })

    it('is a no-op when buffer is empty', () => {
      coalescer.flush()
      expect(flushed).toHaveLength(0)
    })
  })

  describe('dispose', () => {
    it('flushes pending buffer on dispose', () => {
      coalescer.push(msg('chunk', 'unflushed'))
      coalescer.dispose()

      expect(flushed).toHaveLength(1)
      expect(flushed[0][0].content).toBe('unflushed')
    })

    it('clears timer on dispose', () => {
      coalescer.push(msg('chunk', 'data'))
      coalescer.dispose()
      flushed.length = 0

      vi.advanceTimersByTime(100)
      expect(flushed).toHaveLength(0)
    })

    it('silently drops events pushed after dispose', () => {
      coalescer.dispose()
      coalescer.push(msg('chunk', 'after dispose'))

      vi.advanceTimersByTime(100)
      expect(flushed).toHaveLength(0)
    })

    it('is idempotent — second dispose does not flush again', () => {
      coalescer.push(msg('chunk', 'data'))
      coalescer.dispose()
      expect(flushed).toHaveLength(1)

      flushed.length = 0
      coalescer.dispose() // second call
      expect(flushed).toHaveLength(0)
    })
  })

  describe('adaptive window', () => {
    it('uses backpressure function to widen window', () => {
      const backpressure = vi.fn().mockReturnValue(55)
      const adaptive = new EventCoalescer<WebSocketMessage>(flushFn, {
        baseWindowMs: 30,
        getBackpressure: backpressure
      })

      adaptive.push(msg('chunk', 'a'))
      vi.advanceTimersByTime(30)
      expect(flushed).toHaveLength(0)

      vi.advanceTimersByTime(70)
      expect(flushed).toHaveLength(1)

      adaptive.dispose()
    })

    it('uses mid-tier 60ms window when backpressure is moderate', () => {
      const backpressure = vi.fn().mockReturnValue(30) // > 20 && <= 50
      const adaptive = new EventCoalescer<WebSocketMessage>(flushFn, {
        baseWindowMs: 30,
        getBackpressure: backpressure
      })

      adaptive.push(msg('chunk', 'a'))
      vi.advanceTimersByTime(30)
      expect(flushed).toHaveLength(0) // not yet — window is 60ms

      vi.advanceTimersByTime(30) // total 60ms
      expect(flushed).toHaveLength(1)

      adaptive.dispose()
    })

    it('uses base window when backpressure is low', () => {
      const backpressure = vi.fn().mockReturnValue(5)
      const adaptive = new EventCoalescer<WebSocketMessage>(flushFn, {
        baseWindowMs: 30,
        getBackpressure: backpressure
      })

      adaptive.push(msg('chunk', 'a'))
      vi.advanceTimersByTime(30)
      expect(flushed).toHaveLength(1)

      adaptive.dispose()
    })
  })

  describe('timer-path flush errors', () => {
    it('catches synchronous Error throws from onFlush and reports with context', () => {
      const warn = vi.fn()
      const throwing = new EventCoalescer<WebSocketMessage>(
        () => { throw new Error('downstream blew up') },
        {
          baseWindowMs: 30,
          logger: { warn },
          logContext: { subscriberId: 'sub-1', transport: 'ws' },
        },
      )

      throwing.push(msg('chunk', 'a'))
      throwing.push(msg('chunk', 'b'))
      throwing.push(msg('chunk', 'c'))
      expect(() => vi.advanceTimersByTime(30)).not.toThrow()

      expect(warn).toHaveBeenCalledWith('coalescer.flush_threw', expect.objectContaining({
        subscriberId: 'sub-1',
        transport: 'ws',
        error: 'downstream blew up',
        eventType: 'chunk',
        coalescedCount: 3,
      }))

      throwing.dispose()
    })

    it('coerces non-Error throws via String() so the logger payload is always a string', () => {
      const warn = vi.fn()
      const throwing = new EventCoalescer<WebSocketMessage>(
        () => { throw 'plain string failure' },
        { baseWindowMs: 30, logger: { warn } },
      )

      throwing.push(msg('chunk', 'x'))
      expect(() => vi.advanceTimersByTime(30)).not.toThrow()

      expect(warn).toHaveBeenCalledWith('coalescer.flush_threw', expect.objectContaining({
        error: 'plain string failure',
      }))

      throwing.dispose()
    })

    it('clears pending state after a timer-path throw so the next push starts fresh', () => {
      const warn = vi.fn()
      let shouldThrow = true
      const flushed_local: CoalescedMessage<WebSocketMessage>[][] = []
      const throwing = new EventCoalescer<WebSocketMessage>(
        (msgs) => {
          if (shouldThrow) {
            shouldThrow = false
            throw new Error('first flush fails')
          }
          flushed_local.push([...msgs])
        },
        { baseWindowMs: 30, logger: { warn } },
      )

      throwing.push(msg('chunk', 'lost'))
      vi.advanceTimersByTime(30)
      expect(warn).toHaveBeenCalledOnce()
      expect(flushed_local).toHaveLength(0)

      // Recovery: next push should buffer + flush as a fresh event, not merge
      // with the dropped one.
      throwing.push(msg('chunk', 'recovered'))
      vi.advanceTimersByTime(30)

      expect(flushed_local).toHaveLength(1)
      expect(flushed_local[0][0].content).toBe('recovered')
      expect(flushed_local[0][0].coalescedCount).toBeUndefined()

      throwing.dispose()
    })
  })

  describe('single event passthrough', () => {
    it('single coalesceable event flushes on timer', () => {
      coalescer.push(msg('chunk', 'solo'))
      vi.advanceTimersByTime(30)

      expect(flushed).toHaveLength(1)
      expect(flushed[0][0].content).toBe('solo')
    })
  })
})
