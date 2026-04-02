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
    const context = createMockMessageContext({
      helpers: {
        ...createMockMessageContext().helpers,
        getConversationIdFromCookie: vi.fn().mockReturnValue('conv-1'),
      },
    })

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: { id: 'stream-1', content: 'test content' },
      streamingState: 'streaming',
      connectionRetry: { isRetrying: true },
      historyLoadRequested: false,
      historyLoadingComplete: false,
      setHistoryLoadRequested: vi.fn(),
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

    expect(clearActiveStream).toHaveBeenCalled()
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'STREAM_COMPLETE' })
    expect(clearConnectionRetry).toHaveBeenCalled()
    expect(context.helpers.clearRetryState).toHaveBeenCalled()
    expect(context.socket.emit).toHaveBeenCalledWith('load_history', { conversationId: 'conv-1' })
  })

  it('clears activeStream and transitions machine when stream completed with no buffered events', async () => {
    const clearConnectionRetry = vi.fn()
    const clearActiveStream = vi.fn()
    const setStreamingState = vi.fn()
    const setIsLoading = vi.fn()
    const context = createMockMessageContext({
      helpers: {
        ...createMockMessageContext().helpers,
        getConversationIdFromCookie: vi.fn().mockReturnValue('conv-1'),
      },
    })

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: {
        id: 'stream-1',
        content: 'Assistant response',
        segments: [{ id: 'seg-1', type: 'text', content: 'test' }],
        toolCalls: [],
      },
      connectionRetry: { isRetrying: false },
      historyLoadRequested: false,
      historyLoadingComplete: false,
      setHistoryLoadRequested: vi.fn(),
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
      },
    }

    await handler.handle(data, context)

    expect(clearActiveStream).toHaveBeenCalled()
    expect(context.actions.finalizeStream).not.toHaveBeenCalled()
    expect(context.actions.flushToolDeltaBufferImmediate).not.toHaveBeenCalled()
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'STREAM_COMPLETE' })
    expect(context.helpers.clearRetryState).toHaveBeenCalled()
    expect(clearConnectionRetry).not.toHaveBeenCalled()
    expect(context.socket.emit).toHaveBeenCalledWith('load_history', { conversationId: 'conv-1' })
  })

  it('emits load_history from cookie when recovery finalizes and history not yet loaded', async () => {
    const context = createMockMessageContext({
      helpers: {
        ...createMockMessageContext().helpers,
        getConversationIdFromCookie: vi.fn().mockReturnValue('conv-123'),
      },
    })

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      historyLoadRequested: false,
      historyLoadingComplete: false,
      setHistoryLoadRequested: vi.fn(),
    })

    await handler.handle(
      { type: 'recovery_status', content: '', data: { isRecovering: false, eventsReplayed: 0 } },
      context
    )

    expect(context.socket.emit).toHaveBeenCalledWith('load_history', { conversationId: 'conv-123' })
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'CATCHUP_COMPLETE' })
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
      streamCompleted: false,
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
