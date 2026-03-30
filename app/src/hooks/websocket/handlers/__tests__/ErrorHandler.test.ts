/**
 * ErrorHandler Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { ErrorHandler } from '../ErrorHandler'
import type { WebSocketMessage } from '../types'

const mockLogImpressionEvent = vi.fn(() => vi.fn())
vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (...args: unknown[]) => mockLogImpressionEvent(...args),
}))

describe('ErrorHandler', () => {
  const handler = new ErrorHandler()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    mockLogImpressionEvent.mockClear()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('handles budget exceeded errors immediately', async () => {
    const context = createMockMessageContext({
      refs: {
        serverConfig: { current: null },
        pendingRecoveryAck: { current: { conversationId: 'c1' } as any },
        toolDeltaBuffer: { current: new Map() },
        retryState: { current: { retryCount: 0 } },
      },
    })

    const data: WebSocketMessage = {
      type: 'error',
      content: 'Budget exceeded',
      data: {
        errorType: 'BUDGET_EXCEEDED',
        statusCode: 429,
        timestamp: '123',
        agentId: 'develop',
        step: 2,
      },
    }

    await handler.handle(data, context)

    expect(context.actions.markBudgetExceeded).toHaveBeenCalled()
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({
      agentId: 'develop',
      totalSteps: 2,
    })
    expect(context.helpers.sendToolImpression).toHaveBeenCalledWith('error')
    // Machine handles UI state transitions via STREAM_ERROR event (Tier 1)
    // Adapter syncs: setWebSocketState, setStreamingState, setIsLoading
    expect(context.helpers.clearRetryState).toHaveBeenCalled()
    // Note: We no longer clear the stored socket ID on errors to enable recovery on page reload
    expect(context.refs.pendingRecoveryAck.current).toBeNull()
    // Logs budget exceeded impression
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('credits.budget.exceeded')
  })

  it('retries APP_NOT_FOUND errors within retry window', async () => {
    const pendingMessage = {
      chatMessage: {
        message: 'Hello',
        context: { metadata: {} },
      },
      startTime: Date.now(),
    }

    const context = createMockMessageContext({
      refs: {
        serverConfig: { current: null },
        pendingRecoveryAck: { current: null },
        toolDeltaBuffer: { current: new Map() },
        retryState: {
          current: {
            pendingMessage,
            retryCount: 0,
          },
        },
      },
    })

    const data: WebSocketMessage = {
      type: 'error',
      content: 'App not found',
      data: {
        errorType: 'APP_NOT_FOUND',
      },
    }

    await handler.handle(data, context)

    const retryState = context.refs.retryState.current
    expect(retryState.retryCount).toBe(1)
    expect(retryState.retryTimer).toBeDefined()
    expect(context.helpers.clearRetryState).not.toHaveBeenCalled()
    expect(context.actions.markUpstreamError).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    expect(context.socket.emit).toHaveBeenCalledWith(
      'chat_message',
      expect.objectContaining({
        message: 'Hello',
        context: expect.objectContaining({
          metadata: expect.objectContaining({
            appId: 'app-123',
            sessionId: 'socket-123',
            userId: 'current-user',
          }),
        }),
      }),
    )
    expect(retryState.retryTimer).toBeUndefined()
  })
})
