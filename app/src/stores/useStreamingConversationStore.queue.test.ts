/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'

import { QUEUE_MAX, useStreamingConversationStore } from './useStreamingConversationStore'

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function getState() {
  return useStreamingConversationStore.getState()
}

describe('useStreamingConversationStore queue', () => {
  beforeEach(() => {
    act(() => {
      getState().cleanup()
    })
    vi.clearAllMocks()
  })

  describe('enqueueMessage', () => {
    it('adds a message and assigns id + timestamp', () => {
      let ok = false
      act(() => {
        ok = getState().enqueueMessage({ content: 'first' })
      })
      expect(ok).toBe(true)

      const queue = getState().queuedMessages
      expect(queue).toHaveLength(1)
      expect(queue[0].content).toBe('first')
      expect(queue[0].id).toEqual(expect.any(String))
      expect(queue[0].id.length).toBeGreaterThan(0)
      expect(queue[0].enqueuedAt).toEqual(expect.any(Number))
    })

    it('preserves snapshot fields on the queued item', () => {
      const ctx = { number: 1, elementInfo: { tagName: 'h1', selector: 'h1' } }
      const assets = [{ imageUrl: 'a.png' }] as never
      act(() => {
        getState().enqueueMessage({
          content: 'with-context',
          aiEditContext: ctx as never,
          selectedAssets: assets,
        })
      })
      const item = getState().queuedMessages[0]
      expect(item.aiEditContext).toEqual(ctx)
      expect(item.selectedAssets).toBe(assets)
    })

    it('rejects when at QUEUE_MAX', () => {
      act(() => {
        for (let i = 0; i < QUEUE_MAX; i += 1) {
          getState().enqueueMessage({ content: `msg-${i}` })
        }
      })
      expect(getState().queuedMessages).toHaveLength(QUEUE_MAX)

      let ok = true
      act(() => {
        ok = getState().enqueueMessage({ content: 'overflow' })
      })
      expect(ok).toBe(false)
      expect(getState().queuedMessages).toHaveLength(QUEUE_MAX)
    })
  })

  describe('removeQueuedMessage', () => {
    it('removes the matching id', () => {
      act(() => {
        getState().enqueueMessage({ content: 'a' })
        getState().enqueueMessage({ content: 'b' })
      })
      const [first] = getState().queuedMessages
      act(() => {
        getState().removeQueuedMessage(first.id)
      })
      const remaining = getState().queuedMessages
      expect(remaining).toHaveLength(1)
      expect(remaining[0].content).toBe('b')
    })

    it('is a no-op for an unknown id', () => {
      act(() => {
        getState().enqueueMessage({ content: 'a' })
      })
      const before = getState().queuedMessages
      act(() => {
        getState().removeQueuedMessage('missing-id')
      })
      expect(getState().queuedMessages).toEqual(before)
    })
  })

  describe('updateQueuedMessage', () => {
    it('rewrites the content of a queued item', () => {
      act(() => {
        getState().enqueueMessage({ content: 'old' })
      })
      const id = getState().queuedMessages[0].id
      act(() => {
        getState().updateQueuedMessage(id, '  new content  ')
      })
      expect(getState().queuedMessages[0].content).toBe('new content')
    })

    it('ignores empty / whitespace-only content', () => {
      act(() => {
        getState().enqueueMessage({ content: 'kept' })
      })
      const id = getState().queuedMessages[0].id
      act(() => {
        getState().updateQueuedMessage(id, '   ')
      })
      expect(getState().queuedMessages[0].content).toBe('kept')
    })

  })

  describe('moveQueuedMessage', () => {
    it('reorders queued items', () => {
      act(() => {
        getState().enqueueMessage({ content: 'a' })
        getState().enqueueMessage({ content: 'b' })
        getState().enqueueMessage({ content: 'c' })
      })
      act(() => {
        getState().moveQueuedMessage(0, 2)
      })
      expect(getState().queuedMessages.map((q) => q.content)).toEqual(['b', 'c', 'a'])
    })

    it('is a no-op for invalid indices', () => {
      act(() => {
        getState().enqueueMessage({ content: 'a' })
        getState().enqueueMessage({ content: 'b' })
      })
      const before = getState().queuedMessages
      act(() => {
        getState().moveQueuedMessage(0, 5)
        getState().moveQueuedMessage(-1, 0)
        getState().moveQueuedMessage(0, 0)
      })
      expect(getState().queuedMessages).toEqual(before)
    })

  })

  describe('takeNextQueuedMessage', () => {
    it('removes and returns the head', () => {
      act(() => {
        getState().enqueueMessage({ content: 'first' })
        getState().enqueueMessage({ content: 'second' })
      })
      let popped: ReturnType<ReturnType<typeof getState>['takeNextQueuedMessage']>
      act(() => {
        popped = getState().takeNextQueuedMessage()
      })
      expect(popped?.content).toBe('first')
      expect(getState().queuedMessages.map((q) => q.content)).toEqual(['second'])
    })

    it('returns null when paused', () => {
      act(() => {
        getState().enqueueMessage({ content: 'first' })
        getState().setQueuePaused(true)
      })
      let popped: ReturnType<ReturnType<typeof getState>['takeNextQueuedMessage']>
      act(() => {
        popped = getState().takeNextQueuedMessage()
      })
      expect(popped).toBeNull()
      expect(getState().queuedMessages).toHaveLength(1)
    })

    it('returns null when empty', () => {
      let popped: ReturnType<ReturnType<typeof getState>['takeNextQueuedMessage']>
      act(() => {
        popped = getState().takeNextQueuedMessage()
      })
      expect(popped).toBeNull()
    })
  })

  describe('setQueuePaused / clearQueue', () => {
    it('toggles paused', () => {
      expect(getState().queuePaused).toBe(false)
      act(() => {
        getState().setQueuePaused(true)
      })
      expect(getState().queuePaused).toBe(true)
      act(() => {
        getState().setQueuePaused(false)
      })
      expect(getState().queuePaused).toBe(false)
    })

    it('clearQueue empties items and clears paused flag', () => {
      act(() => {
        getState().enqueueMessage({ content: 'a' })
        getState().enqueueMessage({ content: 'b' })
        getState().setQueuePaused(true)
      })
      act(() => {
        getState().clearQueue()
      })
      expect(getState().queuedMessages).toHaveLength(0)
      expect(getState().queuePaused).toBe(false)
    })
  })

  describe('per-app isolation', () => {
    it('clears the queue when switching apps', () => {
      act(() => {
        getState().setCurrentAppId('app-1')
        getState().enqueueMessage({ content: 'a' })
        getState().enqueueMessage({ content: 'b' })
        getState().setQueuePaused(true)
      })
      act(() => {
        getState().setCurrentAppId('app-2')
      })
      expect(getState().queuedMessages).toHaveLength(0)
      expect(getState().queuePaused).toBe(false)
    })
  })
})
