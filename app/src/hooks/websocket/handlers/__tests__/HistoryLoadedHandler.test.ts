/**
 * HistoryLoadedHandler Tests
 *
 * history_loaded is the completion signal for the initial load_history request
 * (no cursor). It is the counterpart to the load_history emission in
 * AgentsAvailableHandler.
 *
 * Responsibilities:
 *  - Flush any remaining batched history messages
 *  - Set historyLoadingComplete(true) on success so the reconnect guard in
 *    AgentsAvailableHandler skips re-fetching on subsequent reconnects.
 *    On error leave it false so the client-side safety timeout can retry.
 *  - Update pagination state (hasMore / nextCursor)
 *  - Clear historyBatch and historyBatchTimer refs
 *
 * Stream finalisation is NOT this handler's job — it is handled upstream by
 * ReplayCompleteHandler (buffered-events path) and RecoveryStatusHandler
 * (stream-already-complete path).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { HistoryLoadedHandler } from '../HistoryLoadedHandler'
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

describe('HistoryLoadedHandler', function packageTests() {
  const handler = new HistoryLoadedHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('#handle — historyLoadingComplete', function loadingCompleteTests() {
    it('should set historyLoadingComplete(true) on success', async function setsLoadingComplete() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      await handler.handle(
        { type: 'history_loaded', content: '', data: { messageCount: 5, hasMore: false, nextCursor: null } },
        context
      )

      expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    })
  })

  describe('#handle — server error path', function serverErrorTests() {
    it('should not set historyLoadingComplete when error field is present', async function noLoadingCompleteOnError() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryLoadRequested = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryLoadRequested,
        setHistoryPagination,
      })

      await handler.handle(
        {
          type: 'history_loaded',
          content: '',
          data: { messageCount: 0, hasMore: false, nextCursor: null, error: 'History provider not configured' },
        },
        context
      )

      expect(setHistoryLoadingComplete).not.toHaveBeenCalled()
      expect(setHistoryLoadRequested).toHaveBeenCalledWith(false)
    })

    it('should not update pagination state when error field is present', async function noPaginationOnError() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryLoadRequested: vi.fn(),
        setHistoryPagination,
      })

      await handler.handle(
        {
          type: 'history_loaded',
          content: '',
          data: { messageCount: 0, hasMore: false, nextCursor: null, error: 'DB connection failed' },
        },
        context
      )

      expect(setHistoryPagination).not.toHaveBeenCalled()
    })

    it('should not null out historyBatch ref via success-path cleanup when error field is present', async function noSuccessRefCleanupOnError() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      // Empty batch so flushBatch bails immediately (batch.length === 0)
      const historyBatchRef = { current: [] as any }

      const context = createMockMessageContext({
        refs: {
          ...createMockMessageContext().refs,
          historyBatch: historyBatchRef,
        },
      })

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryLoadRequested: vi.fn(),
        setHistoryPagination,
        messages: [],
        activeStream: null,
      })

      await handler.handle(
        {
          type: 'history_loaded',
          content: '',
          data: { messageCount: 0, error: 'App context not found' },
        },
        context
      )

      // Success-path cleanup (which nulls historyBatch) was not reached
      expect(historyBatchRef.current).not.toBeNull()
    })
  })

  describe('#handle — pagination state', function paginationTests() {
    it('should update pagination with hasMore and nextCursor from payload', async function updatesPagination() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      const data: WebSocketMessage = {
        type: 'history_loaded',
        content: '',
        data: {
          messageCount: 20,
          hasMore: true,
          nextCursor: 'cursor-page2',
        },
      }

      await handler.handle(data, context)

      expect(setHistoryPagination).toHaveBeenCalledWith({
        hasMore: true,
        nextCursor: 'cursor-page2',
      })
    })

    it('should set hasMore false and nextCursor null when first page is the only page', async function singlePage() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      await handler.handle(
        { type: 'history_loaded', content: '', data: { messageCount: 3, hasMore: false, nextCursor: null } },
        context
      )

      expect(setHistoryPagination).toHaveBeenCalledWith({
        hasMore: false,
        nextCursor: null,
      })
    })

    it('should default hasMore to false when field is absent from payload', async function defaultsHasMore() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      await handler.handle(
        { type: 'history_loaded', content: '', data: { messageCount: 2 } },
        context
      )

      expect(setHistoryPagination).toHaveBeenCalledWith(
        expect.objectContaining({ hasMore: false })
      )
    })

    it('should default nextCursor to null when field is absent from payload', async function defaultsNextCursor() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      await handler.handle(
        { type: 'history_loaded', content: '', data: { messageCount: 2 } },
        context
      )

      expect(setHistoryPagination).toHaveBeenCalledWith(
        expect.objectContaining({ nextCursor: null })
      )
    })
  })

  describe('#handle — ref cleanup', function refCleanupTests() {
    it('should null out historyBatch ref', async function clearsHistoryBatch() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const historyBatchRef = { current: [{ id: 'msg-1' }] as any }

      const context = createMockMessageContext({
        refs: {
          ...createMockMessageContext().refs,
          historyBatch: historyBatchRef,
        },
      })

      // flushBatch reads store.messages and store.activeStream when historyBatch.current is set
      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
        messages: [],
        activeStream: null,
        prependMessages: vi.fn(),
        setMessages: vi.fn(),
      })

      await handler.handle(
        { type: 'history_loaded', content: '', data: { messageCount: 1, hasMore: false, nextCursor: null } },
        context
      )

      expect(historyBatchRef.current).toBeNull()
    })

    it('should null out historyBatchTimer ref and clear the timeout', async function clearsHistoryBatchTimer() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const timerId = setTimeout(() => {}, 5000)
      const historyBatchTimerRef = { current: timerId }

      const context = createMockMessageContext({
        refs: {
          ...createMockMessageContext().refs,
          historyBatchTimer: historyBatchTimerRef,
        },
      })

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      await handler.handle(
        { type: 'history_loaded', content: '', data: {} },
        context
      )

      expect(historyBatchTimerRef.current).toBeNull()
    })

    it('should not throw when historyBatch ref is absent from context', async function toleratesAbsentBatchRef() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      await expect(
        handler.handle(
          { type: 'history_loaded', content: '', data: {} },
          context
        )
      ).resolves.not.toThrow()
    })
  })

  describe('#handle — no side effects on machine or stream', function noSideEffectsTests() {
    it('should not send any machine events', async function noMachineEvents() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      await handler.handle(
        { type: 'history_loaded', content: '', data: { messageCount: 5 } },
        context
      )

      expect(context.machine.send).not.toHaveBeenCalled()
    })

    it('should not call stream finalisation actions', async function noStreamFinalisation() {
      const setHistoryLoadingComplete = vi.fn()
      const setHistoryPagination = vi.fn()
      const context = createMockMessageContext()

      mockStore.getState.mockReturnValue({
        setHistoryLoadingComplete,
        setHistoryPagination,
      })

      await handler.handle(
        { type: 'history_loaded', content: '', data: { messageCount: 5 } },
        context
      )

      expect(context.actions.finalizeStream).not.toHaveBeenCalled()
      expect(context.actions.flushToolDeltaBufferImmediate).not.toHaveBeenCalled()
    })
  })
})
