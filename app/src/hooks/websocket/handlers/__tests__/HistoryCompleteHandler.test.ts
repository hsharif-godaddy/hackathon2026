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
    const context = createMockMessageContext()

    mockStore.getState.mockReturnValue({
      activeStream: null,
      setHistoryLoadingComplete,
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 5,
      },
    }

    await handler.handle(data, context)

    expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    expect(context.machine.send).not.toHaveBeenCalled()
  })

  it('sends STREAM_COMPLETE for completed streams (no buffered events)', async () => {
    const setHistoryLoadingComplete = vi.fn()
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
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 3,
      },
    }

    await handler.handle(data, context)

    expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    // Should finalize the stream first (moves to messages, persists)
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({})
    // Then send STREAM_COMPLETE to transition from streaming.receiving to completed
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'STREAM_COMPLETE' })
  })

  it('does not send STREAM_COMPLETE for active streams (has buffered events)', async () => {
    const setHistoryLoadingComplete = vi.fn()
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
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 2,
      },
    }

    await handler.handle(data, context)

    expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    // Should NOT send any machine event - stream is still active and will receive more events
    // STREAM_STARTED was already sent by HistoryMessageHandler
    expect(context.machine.send).not.toHaveBeenCalled()
  })

  it('does not send events when recovery context is missing', async () => {
    const setHistoryLoadingComplete = vi.fn()
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
    })

    const data: WebSocketMessage = {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 1,
      },
    }

    await handler.handle(data, context)

    expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    // Should not send any machine events without recovery context
    expect(context.machine.send).not.toHaveBeenCalled()
  })

  it('clears batch refs after handling', async () => {
    const setHistoryLoadingComplete = vi.fn()
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
})
