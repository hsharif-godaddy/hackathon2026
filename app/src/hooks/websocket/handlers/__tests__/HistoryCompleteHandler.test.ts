/**
 * HistoryCompleteHandler Tests
 *
 * history_complete is a pagination-only event. It updates pagination state and
 * clears the loading-more indicator. Initial history completion is handled
 * by HistoryLoadedHandler (history_loaded event).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { HistoryCompleteHandler } from '../HistoryCompleteHandler'
import type { WebSocketMessage } from '../types'

vi.mock('@/stores/useStreamingConversationStore', async () => {
  const actual = await vi.importActual('@/stores/useStreamingConversationStore')
  const getState = vi.fn()
  const setState = vi.fn()
  return {
    ...actual,
    useStreamingConversationStore: {
      getState,
      setState,
    },
  }
})

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

const mockStore = useStreamingConversationStore as unknown as {
  getState: ReturnType<typeof vi.fn>
  setState: ReturnType<typeof vi.fn>
}

describe('HistoryCompleteHandler', function packageTests() {
  const handler = new HistoryCompleteHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('#handle', function handleTests() {
    it('should update pagination state and clear loadingMore', async function updatePagination() {
      const setHistoryPagination = vi.fn()
      const setHistoryLoadingMore = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryPagination,
        setHistoryLoadingMore,
      })

      const data: WebSocketMessage = {
        type: 'history_complete',
        content: '',
        data: {
          messageCount: 10,
          hasMore: true,
          nextCursor: 'cursor-abc',
        },
      }

      await handler.handle(data, context)

      expect(setHistoryPagination).toHaveBeenCalledWith({
        hasMore: true,
        nextCursor: 'cursor-abc',
      })
      expect(setHistoryLoadingMore).toHaveBeenCalledWith(false)
    })

    it('should set hasMore false and nextCursor null when last page arrives', async function lastPage() {
      const setHistoryPagination = vi.fn()
      const setHistoryLoadingMore = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryPagination,
        setHistoryLoadingMore,
      })

      const data: WebSocketMessage = {
        type: 'history_complete',
        content: '',
        data: {
          messageCount: 5,
          hasMore: false,
          nextCursor: null,
        },
      }

      await handler.handle(data, context)

      expect(setHistoryPagination).toHaveBeenCalledWith({
        hasMore: false,
        nextCursor: null,
      })
      expect(setHistoryLoadingMore).toHaveBeenCalledWith(false)
    })

    it('should default hasMore to false and nextCursor to null when absent from data', async function defaultsOnMissingFields() {
      const setHistoryPagination = vi.fn()
      const setHistoryLoadingMore = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryPagination,
        setHistoryLoadingMore,
      })

      const data: WebSocketMessage = {
        type: 'history_complete',
        content: '',
        data: { messageCount: 3 },
      }

      await handler.handle(data, context)

      expect(setHistoryPagination).toHaveBeenCalledWith({
        hasMore: false,
        nextCursor: null,
      })
      expect(setHistoryLoadingMore).toHaveBeenCalledWith(false)
    })

    it('should not call setHistoryLoadingComplete (that is HistoryLoadedHandler responsibility)', async function noLoadingComplete() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const setHistoryLoadingMore = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
        setHistoryLoadingMore,
      })

      await handler.handle(
        { type: 'history_complete', content: '', data: { messageCount: 5, hasMore: false, nextCursor: null } },
        context,
      )

      expect(setHistoryLoadingComplete).not.toHaveBeenCalled()
    })

    it('should not send any machine events', async function noMachineEvents() {
      const setHistoryPagination = vi.fn()
      const setHistoryLoadingMore = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryPagination,
        setHistoryLoadingMore,
      })

      await handler.handle(
        { type: 'history_complete', content: '', data: { messageCount: 2, hasMore: true, nextCursor: 'c' } },
        context,
      )

      expect(context.machine.send).not.toHaveBeenCalled()
    })

    it('should not call stream finalisation actions', async function noStreamFinalisation() {
      const setHistoryPagination = vi.fn()
      const setHistoryLoadingMore = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryPagination,
        setHistoryLoadingMore,
      })

      await handler.handle(
        { type: 'history_complete', content: '', data: { messageCount: 4 } },
        context,
      )

      expect(context.actions.finalizeStream).not.toHaveBeenCalled()
      expect(context.actions.flushToolDeltaBufferImmediate).not.toHaveBeenCalled()
    })

    it('should clear historyBatch and historyBatchTimer refs', async function clearBatchRefs() {
      const setHistoryPagination = vi.fn()
      const setHistoryLoadingMore = vi.fn()
      const historyBatchRef = { current: { messages: [] } }
      const historyBatchTimerRef = { current: setTimeout(() => {}, 100) }

      const context = createMockMessageContext({
        refs: {
          ...createMockMessageContext().refs,
          historyBatch: historyBatchRef as any,
          historyBatchTimer: historyBatchTimerRef as any,
        },
      })

      mockStore.getState.mockReturnValue({
        messages: [],
        activeStream: null,
        setHistoryPagination,
        setHistoryLoadingMore,
      })

      await handler.handle(
        { type: 'history_complete', content: '', data: { messageCount: 0 } },
        context,
      )

      expect(historyBatchRef.current).toBeNull()
      expect(historyBatchTimerRef.current).toBeNull()
    })
  })
})
