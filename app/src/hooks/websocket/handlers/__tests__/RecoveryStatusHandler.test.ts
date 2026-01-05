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

vi.mock('@/services/AgentService', () => ({
  AgentService: {
    getInstance: vi.fn(),
  },
}))

import { AgentService } from '@/services/AgentService'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

const mockStore = useStreamingConversationStore as unknown as {
  getState: ReturnType<typeof vi.fn>
  setState: ReturnType<typeof vi.fn>
}
const mockAgentService = AgentService.getInstance as unknown as ReturnType<typeof vi.fn>

describe('RecoveryStatusHandler', () => {
  const handler = new RecoveryStatusHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles completed streams by loading history and finalizing state', async () => {
    const clearConnectionRetry = vi.fn()
    const context = createMockMessageContext()

    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: { id: 'stream-1' },
      connectionRetry: { isRetrying: true },
      clearConnectionRetry,
    })
    mockStore.setState.mockImplementation(() => undefined)

    const getConversation = vi.fn().mockResolvedValue({
      messages: [{ id: 'msg-1', sender: 'assistant', content: 'test', createdAt: new Date().toISOString() }],
    })
    mockAgentService.mockReturnValue({ getConversation })

    const data: WebSocketMessage = {
      type: 'recovery_status',
      content: '',
      data: {
        streamCompleted: true,
        conversationId: 'conv-1',
      },
    }

    await handler.handle(data, context)

    expect(getConversation).toHaveBeenCalledWith('app-123', 'conv-1')
    expect(mockStore.setState).toHaveBeenCalledWith({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: 'msg-1', role: 'assistant', content: 'test' })
      ])
    })
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({})
    expect(clearConnectionRetry).toHaveBeenCalled()
    expect(context.helpers.clearRetryState).toHaveBeenCalled()
    // Machine handles UI state transitions via STREAM_COMPLETE event (Tier 1)
    // (Already sent by CompleteHandler when stream was completed before recovery)
    expect(context.helpers.clearStoredSocketId).toHaveBeenCalled()
  })

  it('prepares buffered event replay and sets pending ack', async () => {
    const context = createMockMessageContext()
    mockStore.getState.mockReturnValue({
      currentAppId: 'app-123',
      activeStream: null,
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
    })
    mockStore.setState.mockImplementation(() => undefined)

    const getConversation = vi.fn().mockResolvedValue({
      messages: [{ id: 'msg-2', sender: 'user', content: 'hello', createdAt: new Date().toISOString() }],
    })
    mockAgentService.mockReturnValue({ getConversation })

    const data: WebSocketMessage = {
      type: 'recovery_status',
      content: '',
      data: {
        hasBufferedEvents: true,
        requiresAck: true,
        bufferedEventCount: 0,
        conversationId: 'conv-2',
        lastSequence: 42,
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
    expect(context.helpers.maybeSendRecoveryAck).toHaveBeenCalledWith(context.socket)
    // Should set both activeStream (from initializeRecoveryStream) and messages (from loadConversationHistory)
    expect(mockStore.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'msg-2', role: 'user', content: 'hello' })
        ])
      })
    )
    // Machine should already be in streaming state during recovery (Tier 1)
    // Adapter syncs streamingState from machine
  })
})
