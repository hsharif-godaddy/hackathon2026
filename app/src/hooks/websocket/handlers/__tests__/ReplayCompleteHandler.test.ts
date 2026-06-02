/**
 * ReplayCompleteHandler Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { ReplayCompleteHandler } from '../ReplayCompleteHandler'
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

describe('ReplayCompleteHandler', () => {
  const handler = new ReplayCompleteHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks replayComplete and sends ack', async () => {
    const pendingAck = {
      conversationId: 'conv-1',
      lastSequence: 10,
      expectedCount: 3,
      receivedCount: 3,
      replayComplete: false,
      ackEvent: 'recovery_ack',
    }

    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        pendingRecoveryAck: { current: pendingAck },
      },
    })

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: null,
    })

    const data: WebSocketMessage = {
      type: 'replay_complete',
      content: '',
      data: {
        conversationId: 'conv-1',
        lastSequence: 15,
        eventsReplayed: 3,
      },
    }

    await handler.handle(data, context)

    expect(pendingAck.replayComplete).toBe(true)
    expect(pendingAck.lastSequence).toBe(15)
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'REPLAY_COMPLETE' })
    expect(context.helpers.maybeSendRecoveryAck).toHaveBeenCalledWith(context.socket, true)
  })

  it('finalizes stream after replay when server says stream completed', async () => {
    const pendingAck = {
      conversationId: 'conv-1',
      lastSequence: 10,
      expectedCount: 2,
      receivedCount: 2,
      replayComplete: false,
      ackEvent: 'recovery_ack',
      streamCompleted: true,
    }

    // maybeSendRecoveryAck clears pendingRecoveryAck (simulating ack sent)
    const pendingRef = { current: pendingAck as any }
    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        pendingRecoveryAck: pendingRef,
      },
    })

    // Simulate maybeSendRecoveryAck clearing the ref (as the real implementation does)
    ;(context.helpers.maybeSendRecoveryAck as any).mockImplementation(function () {
      pendingRef.current = null
    })

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: {
        id: 'msg-1',
        role: 'assistant',
        content: 'some content',
        isComplete: false,
      },
    })

    const data: WebSocketMessage = {
      type: 'replay_complete',
      content: '',
      data: {
        conversationId: 'conv-1',
        lastSequence: 15,
        eventsReplayed: 2,
      },
    }

    await handler.handle(data, context)

    // Should finalize stream since server said it's completed
    expect(context.actions.flushToolDeltaBufferImmediate).toHaveBeenCalled()
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({})
    expect(context.machine.send).toHaveBeenCalledWith({ type: 'STREAM_COMPLETE' })
  })

  it('does not finalize stream when server says stream is still active', async () => {
    const pendingAck = {
      conversationId: 'conv-1',
      lastSequence: 10,
      expectedCount: 2,
      receivedCount: 2,
      replayComplete: false,
      ackEvent: 'recovery_ack',
      streamCompleted: false,
    }

    const pendingRef = { current: pendingAck as any }
    const context = createMockMessageContext({
      refs: {
        ...createMockMessageContext().refs,
        pendingRecoveryAck: pendingRef,
      },
    })

    ;(context.helpers.maybeSendRecoveryAck as any).mockImplementation(function () {
      pendingRef.current = null
    })

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: {
        id: 'msg-1',
        role: 'assistant',
        content: 'streaming content',
        isComplete: false,
      },
    })

    const data: WebSocketMessage = {
      type: 'replay_complete',
      content: '',
      data: {
        conversationId: 'conv-1',
        lastSequence: 15,
        eventsReplayed: 2,
      },
    }

    await handler.handle(data, context)

    // Should NOT finalize — stream is still active
    expect(context.actions.finalizeStream).not.toHaveBeenCalled()
  })

  it('skips when app has changed', async () => {
    const context = createMockMessageContext({
      currentAppId: 'app-123',
    })

    mockStore.getState.mockReturnValue({
      currentAppId: 'different-app',
    })

    const data: WebSocketMessage = {
      type: 'replay_complete',
      content: '',
      data: {
        conversationId: 'conv-1',
        lastSequence: 15,
      },
    }

    await handler.handle(data, context)

    expect(context.machine.send).not.toHaveBeenCalled()
    expect(context.refs.pendingRecoveryAck.current).toBeNull()
  })
})
