/**
 * HistoryCompleteHandler Tests
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

describe('HistoryCompleteHandler', () => {
  const handler = new HistoryCompleteHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes history loading without activeStream', async () => {
    const setHistoryLoadingComplete = vi.fn()
    const setHistoryPagination = vi.fn()
    const setHistoryLoadingMore = vi.fn()
    const context = createMockMessageContext()

    mockStore.getState.mockReturnValue({
      activeStream: null,
      setHistoryLoadingComplete,
      setHistoryPagination,
      setHistoryLoadingMore,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 5,
        hasMore: true,
        nextCursor: 'cursor-abc',
      },
    }

    await handler.handle(data, context)

    expect(setHistoryPagination).toHaveBeenCalledWith({
      hasMore: true,
      nextCursor: 'cursor-abc',
    })
    expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    expect(setHistoryLoadingMore).toHaveBeenCalledWith(false)
    expect(context.machine.send).not.toHaveBeenCalled()
  })

  it('sends STREAM_COMPLETE for completed streams (no buffered events)', async () => {
    const setHistoryLoadingComplete = vi.fn()
    const setHistoryPagination = vi.fn()
    const setHistoryLoadingMore = vi.fn()
    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        historyReceivedForRecovery: { current: false },
        pendingRecoveryAck: {
          current: {
            conversationId: 'conv-123',
            lastSequence: 42,
            expectedCount: 0,
            receivedCount: 0,
            replayComplete: true,
            ackEvent: 'recovery_ack',
          },
        },
      },
      machine: {
        send: vi.fn(),
        getSnapshot: vi.fn(() => ({
          matches: vi.fn((pattern: any) => {
            // Machine is in streaming.receiving state (set by HistoryMessageHandler)
            if (pattern?.stream?.streaming === 'receiving') {
              return true
            }
            return false
          }),
        })),
      } as any,
    })

    mockStore.getState.mockReturnValue({
      activeStream: {
        id: 'msg-1',
        role: 'assistant',
        content: 'Incomplete content',
        isComplete: false,
      },
      setHistoryLoadingComplete,
      setHistoryPagination,
      setHistoryLoadingMore,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 3,
        hasMore: false,
        nextCursor: null,
      },
    }

    await handler.handle(data, context)

    expect(setHistoryPagination).toHaveBeenCalledWith({
      hasMore: false,
      nextCursor: null,
    })
    expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    // Should flush buffers before finalizing (prevents buffered data loss)
    expect(context.actions.flushToolDeltaBufferImmediate).toHaveBeenCalled()
    // Should finalize the stream first (moves to messages, persists)
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({})
    // Flush must happen before finalize
    const flushMock = context.actions.flushToolDeltaBufferImmediate as unknown as ReturnType<typeof vi.fn>
    const finalizeMock = context.actions.finalizeStream as unknown as ReturnType<typeof vi.fn>
    expect(flushMock.mock.invocationCallOrder[0]).toBeLessThan(finalizeMock.mock.invocationCallOrder[0])
    // Then send STREAM_COMPLETE to transition from streaming.receiving to completed
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'STREAM_COMPLETE' })
  })

  it('finalizes via serverSaysCompleted when isLoading is true', async () => {
    const setHistoryLoadingComplete = vi.fn()
    const setHistoryPagination = vi.fn()
    const setHistoryLoadingMore = vi.fn()
    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        historyReceivedForRecovery: { current: false },
        pendingRecoveryAck: {
          current: {
            conversationId: 'conv-123',
            lastSequence: 42,
            expectedCount: 0,
            receivedCount: 0,
            replayComplete: true,
            ackEvent: 'recovery_ack',
            streamCompleted: true,
          },
        },
      },
      machine: {
        send: vi.fn(),
        getSnapshot: vi.fn(() => ({
          matches: vi.fn((pattern: any) => {
            if (pattern?.stream?.streaming === 'receiving') return true
            return false
          }),
        })),
      } as any,
    })

    mockStore.getState.mockReturnValue({
      activeStream: {
        id: 'msg-1',
        role: 'assistant',
        content: 'content',
        isComplete: false,
      },
      isLoading: true,
      setHistoryLoadingComplete,
      setHistoryPagination,
      setHistoryLoadingMore,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: { messageCount: 3 },
    }

    await handler.handle(data, context)

    // serverSaysCompleted=true should cause finalization even though isLoading=true
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({})
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'STREAM_COMPLETE' })
  })

  it('does not finalize when streamCompleted is false and isLoading is true', async () => {
    const setHistoryLoadingComplete = vi.fn()
    const setHistoryPagination = vi.fn()
    const setHistoryLoadingMore = vi.fn()
    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        historyReceivedForRecovery: { current: false },
        pendingRecoveryAck: {
          current: {
            conversationId: 'conv-123',
            lastSequence: 42,
            expectedCount: 0,
            receivedCount: 0,
            replayComplete: true,
            ackEvent: 'recovery_ack',
            streamCompleted: false,
          },
        },
      },
    })

    mockStore.getState.mockReturnValue({
      activeStream: {
        id: 'msg-2',
        role: 'assistant',
        content: 'streaming',
        isComplete: false,
      },
      isLoading: true,
      setHistoryLoadingComplete,
      setHistoryPagination,
      setHistoryLoadingMore,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: { messageCount: 2 },
    }

    await handler.handle(data, context)

    // Neither serverSaysCompleted nor !isLoading is true → should NOT finalize
    expect(context.actions.finalizeStream).not.toHaveBeenCalled()
    expect(context.machine.send).not.toHaveBeenCalled()
  })

  it('does not send STREAM_COMPLETE for active streams (has buffered events)', async () => {
    const setHistoryLoadingComplete = vi.fn()
    const setHistoryPagination = vi.fn()
    const setHistoryLoadingMore = vi.fn()
    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        historyReceivedForRecovery: { current: false },
        pendingRecoveryAck: {
          current: {
            conversationId: 'conv-456',
            lastSequence: 99,
            expectedCount: 5,
            receivedCount: 0,
            replayComplete: false,
            ackEvent: 'recovery_ack',
          },
        },
      },
    })

    mockStore.getState.mockReturnValue({
      activeStream: {
        id: 'msg-2',
        role: 'assistant',
        content: 'Streaming content',
        isComplete: false,
      },
      setHistoryLoadingComplete,
      setHistoryPagination,
      setHistoryLoadingMore,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 2,
      },
    }

    await handler.handle(data, context)

    expect(setHistoryPagination).toHaveBeenCalledWith({
      hasMore: false,
      nextCursor: null,
    })
    expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    // Should NOT send any machine event - stream is still active and will receive more events
    // STREAM_STARTED was already sent by HistoryMessageHandler
    expect(context.machine.send).not.toHaveBeenCalled()
  })

  it('does not send events when recovery context is missing', async () => {
    const setHistoryLoadingComplete = vi.fn()
    const setHistoryPagination = vi.fn()
    const setHistoryLoadingMore = vi.fn()
    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        historyReceivedForRecovery: { current: false },
        pendingRecoveryAck: {
          current: null, // No recovery context
        },
      },
    })

    mockStore.getState.mockReturnValue({
      activeStream: {
        id: 'msg-orphan',
        role: 'assistant',
        content: 'Orphaned content',
        isComplete: false,
      },
      setHistoryLoadingComplete,
      setHistoryPagination,
      setHistoryLoadingMore,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 1,
      },
    }

    await handler.handle(data, context)

    expect(setHistoryPagination).toHaveBeenCalledWith({
      hasMore: false,
      nextCursor: null,
    })
    expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    // Should not send any machine events without recovery context
    expect(context.machine.send).not.toHaveBeenCalled()
  })

  it('clears batch refs after handling', async () => {
    const setHistoryLoadingComplete = vi.fn()
    const setHistoryPagination = vi.fn()
    const setHistoryLoadingMore = vi.fn()
    const historyBatchRef = { current: { messages: [] } }
    const historyBatchTimerRef = { current: setTimeout(() => {}, 100) }

    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        historyBatch: historyBatchRef as any,
        historyBatchTimer: historyBatchTimerRef as any,
        historyReceivedForRecovery: { current: false },
      },
    })

    mockStore.getState.mockReturnValue({
      activeStream: null,
      setHistoryLoadingComplete,
      setHistoryPagination,
      setHistoryLoadingMore,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 0,
      },
    }

    await handler.handle(data, context)

    expect(historyBatchRef.current).toBeNull()
    expect(historyBatchTimerRef.current).toBeNull()
  })

  it('handles load-more response correctly', async () => {
    const setHistoryLoadingComplete = vi.fn()
    const setHistoryPagination = vi.fn()
    const setHistoryLoadingMore = vi.fn()
    const context = createMockMessageContext()

    mockStore.getState.mockReturnValue({
      activeStream: null,
      setHistoryLoadingComplete,
      setHistoryPagination,
      setHistoryLoadingMore,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 10,
        hasMore: true,
        nextCursor: 'cursor-xyz',
        isLoadMore: true,
      },
    }

    await handler.handle(data, context)

    expect(setHistoryPagination).toHaveBeenCalledWith({
      hasMore: true,
      nextCursor: 'cursor-xyz',
    })
    // Should clear loadingMore state
    expect(setHistoryLoadingMore).toHaveBeenCalledWith(false)
    // Should NOT call setHistoryLoadingComplete for load-more
    expect(setHistoryLoadingComplete).not.toHaveBeenCalled()
  })
})
