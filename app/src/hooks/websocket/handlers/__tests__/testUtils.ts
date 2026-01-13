import { vi } from 'vitest'

import type { MessageContext } from '../types'

export const createMockMessageContext = (
  overrides: Partial<MessageContext> = {}
): MessageContext => ({
  socket: { id: 'socket-123', emit: vi.fn(), connected: true } as any,
  currentAppId: 'app-123',
  actions: {
    setWebSocketState: vi.fn(),
    setStreamingState: vi.fn(),
    setIsLoading: vi.fn(),
    startNewStream: vi.fn(),
    appendTextSegment: vi.fn(),
    addToolStartSegment: vi.fn(),
    addToolCallSegment: vi.fn(),
    addToolResultSegment: vi.fn(),
    markMaxStepsReached: vi.fn(),
    markUpstreamError: vi.fn(),
    markBudgetExceeded: vi.fn(),
    finalizeStream: vi.fn(),
    flushToolDeltaBufferImmediate: vi.fn(),
    scheduleToolDeltaFlush: vi.fn(),
  },
  helpers: {
    maybeSendRecoveryAck: vi.fn(),
    trackReplayEventReceipt: vi.fn(),
    clearStoredSocketId: vi.fn(),
    handleCommitComplete: vi.fn().mockResolvedValue(undefined),
    setConversationIdCookie: vi.fn(),
    clearConversationIdCookie: vi.fn(),
    getConversationIdFromCookie: vi.fn(),
    clearRetryState: vi.fn(),
    sendToolImpression: vi.fn(),
  },
  refs: {
    serverConfig: { current: null },
    pendingRecoveryAck: { current: null },
    toolDeltaBuffer: { current: new Map() },
    retryState: { current: { retryCount: 0 } },
  },
  machine: {
    send: vi.fn(),
    getSnapshot: vi.fn(() => ({
      matches: vi.fn((pattern: any) => {
        // Default: machine is in streaming.receiving state
        if (pattern?.stream?.streaming) {
          return true
        }
        return false
      }),
    })),
  } as any,
  ...overrides,
})
