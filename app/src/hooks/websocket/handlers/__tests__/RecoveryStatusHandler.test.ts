/**
 * RecoveryStatusHandler Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { RecoveryStatusHandler } from '../RecoveryStatusHandler'
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

describe('RecoveryStatusHandler', () => {
  const handler = new RecoveryStatusHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles completed streams by loading history from WebSocket and finalizing state', async () => {
    const clearConnectionRetry = vi.fn()
    const clearActiveStream = vi.fn()
    const setStreamingState = vi.fn()
    const setIsLoading = vi.fn()
    const context = createMockMessageContext()

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: { id: 'stream-1', content: 'test content' },
      streamingState: 'streaming',
      connectionRetry: { isRetrying: true },
      clearConnectionRetry,
      clearActiveStream,
      setStreamingState,
      setIsLoading,
    })
    mockStore.setState.mockImplementation(() => undefined)

    const data: WebSocketMessage = {
      type: 'recovery_status',
      content: '',
      data: {
        streamCompleted: true,
        conversationId: 'conv-1',
        historyStreaming: true,
        historyMessageCount: 1,
      },
    }

    await handler.handle(data, context)

    // When historyStreaming: true, history arrives via history_message events
    // so no messages are set directly here
    expect(clearActiveStream).toHaveBeenCalled()
    // Machine event STREAM_COMPLETE is sent (Tier 1), adapter will sync state
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'STREAM_COMPLETE' })
    expect(clearConnectionRetry).toHaveBeenCalled()
    expect(context.helpers.clearRetryState).toHaveBeenCalled()
    // Note: We no longer clear the stored socket ID to enable recovery on page reload
  })

  it('preserves activeStream by finalizing when history not included', async () => {
    const clearConnectionRetry = vi.fn()
    const clearActiveStream = vi.fn()
    const setStreamingState = vi.fn()
    const setIsLoading = vi.fn()
    const context = createMockMessageContext()

    const activeStreamData = {
      id: 'stream-1',
      content: 'Important assistant response that should not be lost',
      segments: [{ id: 'seg-1', type: 'text', content: 'test' }],
      toolCalls: [],
    }

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: activeStreamData,
      connectionRetry: { isRetrying: false },
      clearConnectionRetry,
      clearActiveStream,
      setStreamingState,
      setIsLoading,
    })
    mockStore.setState.mockImplementation(() => undefined)

    const data: WebSocketMessage = {
      type: 'recovery_status',
      content: '',
      data: {
        streamCompleted: true,
        conversationId: 'conv-1',
        // No historyStreaming flag means history is not available
      },
    }

    await handler.handle(data, context)

    // Should NOT call clearActiveStream - that would lose data
    expect(clearActiveStream).not.toHaveBeenCalled()
    // Should call finalizeStream to preserve the in-memory response
    // finalizeStream sets streamingState: 'idle' and isLoading: false internally
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({})
  })

  it('prepares buffered event replay and sets pending ack with WebSocket history', async () => {
    const context = createMockMessageContext()
    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: null,
      messages: [],
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      setStreamingState: vi.fn(),
      setIsLoading: vi.fn(),
    })
    mockStore.setState.mockImplementation(() => undefined)

    const data: WebSocketMessage = {
      type: 'recovery_status',
      content: '',
      data: {
        hasBufferedEvents: true,
        requiresAck: true,
        bufferedEventCount: 0,
        conversationId: 'conv-2',
        lastSequence: 42,
        historyStreaming: true,
        historyMessageCount: 1,
      },
    }

    await handler.handle(data, context)

    expect(context.refs.pendingRecoveryAck.current).toEqual({
      conversationId: 'conv-2',
      lastSequence: 42,
      expectedCount: 0,
      receivedCount: 0,
      replayComplete: true,
      ackEvent: 'recovery_ack',
    })
    // Don't send ack immediately - wait for replay_complete
    // This prevents sending recovery_ack twice (once on recovery_status, once on replay_complete)
    expect(context.helpers.maybeSendRecoveryAck).not.toHaveBeenCalled()
    // When historyStreaming: true, history arrives via history_message events
    // A placeholder activeStream is created for buffered event replay
    expect(mockStore.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        activeStream: expect.objectContaining({
          role: 'assistant',
          content: '',
          isComplete: false,
        }),
        currentStep: 1,
      })
    )
    // Machine event STREAM_STARTED is sent (Tier 1), adapter syncs streamingState and isLoading
    expect(context.machine.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'STREAM_STARTED',
        conversationId: 'conv-2',
      })
    )
  })

  it('initializes replay deduplication before ACK tracking to avoid race conditions', async () => {
    const baseContext = createMockMessageContext()
    const order: string[] = []

    const pendingRef: any = {}
    let ackValue: any = null
    Object.defineProperty(pendingRef, 'current', {
      configurable: true,
      get() {
        return ackValue
      },
      set(value) {
        order.push('ack')
        ackValue = value
      }
    })

    const controllerMock = {
      isInReplayMode: vi.fn().mockReturnValue(false),
      startReplayDeduplication: vi.fn(() => {
        order.push('dedup')
      }),
      clearReplayDeduplication: vi.fn(),
      hasSeenEvent: vi.fn(),
      markEventSeen: vi.fn(),
    }

    const context = {
      ...baseContext,
      refs: {
        ...baseContext.refs,
        pendingRecoveryAck: pendingRef,
        controller: controllerMock,
      },
    }

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: null,
      messages: [],
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      setStreamingState: vi.fn(),
      setIsLoading: vi.fn(),
    })
    mockStore.setState.mockImplementation(() => undefined)

    const data: WebSocketMessage = {
      type: 'recovery_status',
      content: '',
      data: {
        hasBufferedEvents: true,
        requiresAck: true,
        bufferedEventCount: 2,
        conversationId: 'conv-race',
        lastSequence: 99,
        historyStreaming: true,
        historyMessageCount: 1,
      },
    }

    await handler.handle(data, context)

    expect(order[0]).toBe('dedup')
    expect(order[1]).toBe('ack')
    expect(controllerMock.startReplayDeduplication).toHaveBeenCalledTimes(1)
    expect(pendingRef.current).toMatchObject({
      conversationId: 'conv-race',
      expectedCount: 2,
    })
  })
})
