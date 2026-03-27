/**
 * Store Update Buffer Tests
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import {
  _resetForTesting,
  bufferStoreUpdate,
  bufferTextChunk,
  clearStoreUpdateBuffer,
  flushStoreUpdateBufferImmediate,
} from '../storeUpdateBuffer'

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

const mockStore = useStreamingConversationStore as unknown as {
  getState: ReturnType<typeof vi.fn>
}

describe('storeUpdateBuffer', () => {
  let mockAppendTextSegment: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    _resetForTesting()

    mockAppendTextSegment = vi.fn()
    mockStore.getState.mockReturnValue({
      appendTextSegment: mockAppendTextSegment,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('bufferTextChunk', () => {
    it('coalesces adjacent text chunks into a single appendTextSegment call', async () => {
      bufferTextChunk('Hello')
      bufferTextChunk(' ')
      bufferTextChunk('World')

      await vi.waitFor(() => {
        expect(mockAppendTextSegment).toHaveBeenCalledTimes(1)
        expect(mockAppendTextSegment).toHaveBeenCalledWith('Hello World')
      })
    })

    it('flushes text on immediate flush', () => {
      bufferTextChunk('Hello')
      bufferTextChunk(' World')

      flushStoreUpdateBufferImmediate()

      expect(mockAppendTextSegment).toHaveBeenCalledTimes(1)
      expect(mockAppendTextSegment).toHaveBeenCalledWith('Hello World')
    })

    it('does not call appendTextSegment if no text was buffered', () => {
      flushStoreUpdateBufferImmediate()

      expect(mockAppendTextSegment).not.toHaveBeenCalled()
    })
  })

  describe('bufferStoreUpdate', () => {
    it('queues and replays updates in order', async () => {
      const order: number[] = []
      bufferStoreUpdate(() => order.push(1))
      bufferStoreUpdate(() => order.push(2))
      bufferStoreUpdate(() => order.push(3))

      await vi.waitFor(() => {
        expect(order).toEqual([1, 2, 3])
      })
    })

    it('replays queued updates on immediate flush', () => {
      const order: number[] = []
      bufferStoreUpdate(() => order.push(1))
      bufferStoreUpdate(() => order.push(2))

      flushStoreUpdateBufferImmediate()

      expect(order).toEqual([1, 2])
    })
  })

  describe('interleaved ordering', () => {
    it('preserves exact arrival order of text and tool segments', () => {
      const order: string[] = []

      mockAppendTextSegment.mockImplementation((text: string) => order.push(`text:${text}`))

      bufferTextChunk('Hello ')
      bufferStoreUpdate(() => order.push('tool:start'))
      bufferTextChunk('World')
      bufferStoreUpdate(() => order.push('tool:call'))

      flushStoreUpdateBufferImmediate()

      expect(order).toEqual([
        'text:Hello ',
        'tool:start',
        'text:World',
        'tool:call',
      ])
    })

    it('coalesces only adjacent text entries, not across tool boundaries', () => {
      bufferTextChunk('A')
      bufferTextChunk('B')
      bufferStoreUpdate(() => {}) // tool boundary
      bufferTextChunk('C')
      bufferTextChunk('D')

      flushStoreUpdateBufferImmediate()

      expect(mockAppendTextSegment).toHaveBeenCalledTimes(2)
      expect(mockAppendTextSegment).toHaveBeenNthCalledWith(1, 'AB')
      expect(mockAppendTextSegment).toHaveBeenNthCalledWith(2, 'CD')
    })
  })

  describe('exception safety', () => {
    it('continues processing remaining entries after a queued update throws', () => {
      const order: string[] = []

      bufferStoreUpdate(() => order.push('first'))
      bufferStoreUpdate(() => { throw new Error('boom') })
      bufferStoreUpdate(() => order.push('third'))

      flushStoreUpdateBufferImmediate()

      expect(order).toEqual(['first', 'third'])
    })

    it('continues processing after appendTextSegment throws', () => {
      const order: string[] = []
      mockAppendTextSegment.mockImplementationOnce(() => { throw new Error('text error') })

      bufferTextChunk('will-fail')
      bufferStoreUpdate(() => order.push('after-error'))

      flushStoreUpdateBufferImmediate()

      expect(order).toEqual(['after-error'])
    })
  })

  describe('clearStoreUpdateBuffer', () => {
    it('discards all pending updates without flushing', () => {
      const executed: string[] = []

      bufferTextChunk('stale text')
      bufferStoreUpdate(() => executed.push('stale update'))

      clearStoreUpdateBuffer()
      flushStoreUpdateBufferImmediate()

      expect(mockAppendTextSegment).not.toHaveBeenCalled()
      expect(executed).toEqual([])
    })
  })

  describe('immediate flush', () => {
    it('clears pending state after flush', () => {
      bufferTextChunk('hello')
      bufferStoreUpdate(() => {})

      flushStoreUpdateBufferImmediate()

      // Second flush should be a no-op
      mockAppendTextSegment.mockClear()
      flushStoreUpdateBufferImmediate()

      expect(mockAppendTextSegment).not.toHaveBeenCalled()
    })

    it('cancels pending RAF when flushing immediately', () => {
      const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')

      bufferTextChunk('hello')
      flushStoreUpdateBufferImmediate()

      expect(cancelSpy).toHaveBeenCalled()
      expect(mockAppendTextSegment).toHaveBeenCalledWith('hello')
    })
  })
})
