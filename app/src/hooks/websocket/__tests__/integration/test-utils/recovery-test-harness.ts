/**
 * Recovery Test Harness
 *
 * Consolidates setup patterns for recovery integration tests.
 * Provides controllable store state, socket simulator, and timer helpers.
 */

import { vi } from 'vitest'

import type { SocketSimulator } from './socket-simulator'

// Constants matching useStreamingWebSocket.ts
export const ESCALATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Factory for initial store state (mirrors useStreamingWebSocket.test.ts pattern)
 *
 * Note: Mock implementations are added AFTER object creation to ensure proper
 * closure binding. vi.fn(impl) defined inline during object literal creation
 * can have issues with closures referencing the object being constructed.
 */
export function createInitialStoreState() {
  // Create base state object with plain mocks first
  const state = {
    streamingState: 'idle' as 'idle' | 'streaming' | 'error' | 'retrying',
    activeStream: null as null | { agentId: string },
    currentAppId: null as string | null,
    messages: [] as unknown[],
    conversations: [] as unknown[],
    updateToolDelta: vi.fn(),
    connectionRetry: {
      isRetrying: false,
      retryStartedAt: null as number | null,
      wasStreamingOnDisconnect: false,
      disconnectSocketId: null as string | null,
      escalationTimeoutId: null as ReturnType<typeof setTimeout> | null,
    },
    // Store actions - implementations defined inline for reliable state changes
    startConnectionRetry(socketId: string) {
      state.connectionRetry.isRetrying = true
      state.connectionRetry.wasStreamingOnDisconnect = true
      state.connectionRetry.disconnectSocketId = socketId
      state.connectionRetry.retryStartedAt = Date.now()
      state.streamingState = 'retrying'
    },
    setEscalationTimeout(timeoutId: ReturnType<typeof setTimeout>) {
      state.connectionRetry.escalationTimeoutId = timeoutId
    },
    clearConnectionRetry() {
      if (state.connectionRetry.escalationTimeoutId) {
        clearTimeout(state.connectionRetry.escalationTimeoutId)
      }
      state.connectionRetry.isRetrying = false
      state.connectionRetry.wasStreamingOnDisconnect = false
      state.connectionRetry.disconnectSocketId = null
      state.connectionRetry.retryStartedAt = null
      state.connectionRetry.escalationTimeoutId = null
    },
    checkStaleRetry: vi.fn(() => false),
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
  }

  // Wrap actionable methods with spies so tests can assert call counts
  vi.spyOn(state, 'startConnectionRetry')
  vi.spyOn(state, 'setEscalationTimeout')
  vi.spyOn(state, 'clearConnectionRetry')

  return state
}

export type StoreState = ReturnType<typeof createInitialStoreState>

/**
 * Creates mock functions for all the store hooks used by useStreamingWebSocket
 */
export function createStoreMocks(storeState: StoreState) {
  const mockSetWebSocketState = vi.fn()
  const mockSetStreamingState = vi.fn()
  const mockSetIsLoading = vi.fn()
  const mockStartNewStream = vi.fn()
  const mockAppendTextSegment = vi.fn()
  const mockAddToolStartSegment = vi.fn()
  const mockAddToolCallSegment = vi.fn()
  const mockAddToolResultSegment = vi.fn()
  const mockMarkMaxStepsReached = vi.fn()
  const mockMarkUpstreamError = vi.fn()
  const mockMarkBudgetExceeded = vi.fn()
  const mockFinalizeStream = vi.fn()

  return {
    mockSetWebSocketState,
    storeMocks: {
      useWebSocketState: vi.fn(() => ({ connected: false, status: 'idle' })),
      useCurrentAppId: vi.fn(() => storeState.currentAppId),
      useStartNewStream: vi.fn(() => mockStartNewStream),
      useAppendTextSegment: vi.fn(() => mockAppendTextSegment),
      useAddToolStartSegment: vi.fn(() => mockAddToolStartSegment),
      useAddToolCallSegment: vi.fn(() => mockAddToolCallSegment),
      useAddToolResultSegment: vi.fn(() => mockAddToolResultSegment),
      useMarkMaxStepsReached: vi.fn(() => mockMarkMaxStepsReached),
      useMarkUpstreamError: vi.fn(() => mockMarkUpstreamError),
      useMarkBudgetExceeded: vi.fn(() => mockMarkBudgetExceeded),
      useFinalizeStream: vi.fn(() => mockFinalizeStream),
      useSetWebSocketState: vi.fn(() => mockSetWebSocketState),
      useSetStreamingState: vi.fn(() => mockSetStreamingState),
      useSetIsLoading: vi.fn(() => mockSetIsLoading),
      useStreamingConversationStore: {
        getState: vi.fn(() => storeState),
        setState: vi.fn((updater: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => {
          if (typeof updater === 'function') {
            Object.assign(storeState, updater(storeState))
          } else {
            Object.assign(storeState, updater)
          }
        }),
        subscribe: vi.fn(() => vi.fn()),
      },
    },
    actionMocks: {
      setWebSocketState: mockSetWebSocketState,
      setStreamingState: mockSetStreamingState,
      setIsLoading: mockSetIsLoading,
      startNewStream: mockStartNewStream,
      appendTextSegment: mockAppendTextSegment,
      addToolStartSegment: mockAddToolStartSegment,
      addToolCallSegment: mockAddToolCallSegment,
      addToolResultSegment: mockAddToolResultSegment,
      markMaxStepsReached: mockMarkMaxStepsReached,
      markUpstreamError: mockMarkUpstreamError,
      markBudgetExceeded: mockMarkBudgetExceeded,
      finalizeStream: mockFinalizeStream,
    },
  }
}

/**
 * Creates logger mocks for asserting log output
 */
export function createLoggerMocks() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

/**
 * Timer control helpers
 */
export async function advanceToEscalationTimeout() {
  await vi.advanceTimersByTimeAsync(ESCALATION_TIMEOUT_MS)
}

export async function advanceByMs(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

/**
 * Helper to send a message through the socket and wait for handlers
 */
export async function sendMessage(
  socket: SocketSimulator,
  message: { type: string; content?: string; data?: Record<string, unknown> }
) {
  socket.serverEmit('message', message)
  // Allow microtasks to flush
  await Promise.resolve()
  await Promise.resolve()
}

/**
 * Helper to simulate connection drop during streaming
 */
export function simulateConnectionDrop(socket: SocketSimulator, storeState: StoreState) {
  storeState.streamingState = 'streaming'
  storeState.connectionRetry.wasStreamingOnDisconnect = true
  storeState.connectionRetry.disconnectSocketId = socket.id
  socket.simulateDisconnect('transport close')
}
