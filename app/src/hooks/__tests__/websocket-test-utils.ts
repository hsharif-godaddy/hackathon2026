/**
 * WebSocket Test Utilities
 *
 * Test harnesses and helpers to simplify WebSocket-related testing.
 * Reduces boilerplate and provides consistent test setup.
 */

import type { Mock } from 'vitest'
import { vi } from 'vitest'

import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
import type { StreamingWebSocketController } from '@/services/websocket/StreamingWebSocketController'
import type { WebSocketState } from '@/stores/useStreamingConversationStore'

/**
 * Create a mock WebSocket controller with sensible defaults
 */
export function createMockController(
  overrides?: Partial<Record<keyof StreamingWebSocketController, Mock>>
): StreamingWebSocketController {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    destroy: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    stopGeneration: vi.fn(),
    loadMoreHistory: vi.fn().mockReturnValue(true),
    emitGrantContext: vi.fn().mockReturnValue(true),
    onGrantRefreshRequested: vi.fn().mockReturnValue(() => {}),
    flushToolDeltaBufferImmediate: vi.fn(),
    scheduleToolDeltaFlush: vi.fn(),
    isInReplayMode: vi.fn().mockReturnValue(false),
    startReplayDeduplication: vi.fn(),
    clearReplayDeduplication: vi.fn(),
    hasSeenEvent: vi.fn().mockReturnValue(false),
    markEventSeen: vi.fn(),
    ...overrides
  } as unknown as StreamingWebSocketController
}

/**
 * Create a mock WebSocket state with sensible defaults
 */
export function createMockWebSocketState(
  overrides?: Partial<WebSocketState>
): WebSocketState {
  return {
    connected: false,
    status: 'idle',
    error: undefined,
    ...overrides
  }
}

/**
 * Create a mock SendMessageOptions object
 */
export function createMockMessageOptions(
  overrides?: Partial<SendMessageOptions>
): SendMessageOptions {
  return {
    content: 'Test message',
    ...overrides
  }
}

/**
 * Test harness for useStreamingWebSocket hook
 * Provides convenient methods for testing hook behavior
 */
export interface WebSocketTestHarness {
  /** The mock controller instance */
  controller: StreamingWebSocketController

  /** Current WebSocket state */
  state: WebSocketState

  /** Update connection status */
  setConnected: (connected: boolean) => void

  /** Update WebSocket status */
  setStatus: (status: WebSocketState['status']) => void

  /** Set an error state */
  setError: (error: unknown) => void

  /** Clear error state */
  clearError: () => void

  /** Simulate a successful connection */
  simulateConnect: () => void

  /** Simulate a disconnect */
  simulateDisconnect: () => void

  /** Simulate starting a stream */
  simulateStreamStart: () => void

  /** Simulate stream completion */
  simulateStreamComplete: () => void

  /** Simulate a connection error */
  simulateError: (error: unknown) => void

  /** Reset all mocks to initial state */
  reset: () => void
}

/**
 * Create a WebSocket test harness with convenient testing utilities
 *
 * @example
 * const harness = createWebSocketTestHarness()
 *
 * // Simulate connection
 * harness.simulateConnect()
 * expect(harness.state.connected).toBe(true)
 *
 * // Test error handling
 * harness.simulateError(new Error('Connection failed'))
 * expect(harness.state.status).toBe('error')
 */
export function createWebSocketTestHarness(options?: {
  controller?: StreamingWebSocketController
  initialState?: Partial<WebSocketState>
}): WebSocketTestHarness {
  const controller = options?.controller ?? createMockController()
  const state: WebSocketState = createMockWebSocketState(options?.initialState)

  const harness: WebSocketTestHarness = {
    controller,
    state,

    setConnected: (connected: boolean) => {
      state.connected = connected
    },

    setStatus: (status: WebSocketState['status']) => {
      state.status = status
    },

    setError: (error: unknown) => {
      state.error = error
      state.status = 'error'
    },

    clearError: () => {
      state.error = undefined
      if (state.status === 'error') {
        state.status = 'idle'
      }
    },

    simulateConnect: () => {
      state.connected = true
      state.status = 'idle'
      state.error = undefined
    },

    simulateDisconnect: () => {
      state.connected = false
      state.status = 'idle'
    },

    simulateStreamStart: () => {
      state.connected = true
      state.status = 'streaming'
    },

    simulateStreamComplete: () => {
      state.status = 'completing'
      // Simulate async completion - callers should use flushPromises() or vi.runAllTimers()
      // to advance to the 'idle' state in tests
      setTimeout(() => {
        state.status = 'idle'
      }, 0)
    },

    simulateError: (error: unknown) => {
      state.error = error
      state.status = 'error'
      state.connected = false
    },

    reset: () => {
      state.connected = false
      state.status = 'idle'
      state.error = undefined
      vi.clearAllMocks()
    }
  }

  return harness
}

/**
 * Create a mock store state for testing
 * Provides a minimal viable store state structure
 */
export function createMockStoreState(overrides?: Record<string, unknown>) {
  return {
    messages: [],
    activeStream: null,
    streamingState: 'idle',
    currentStep: 0,
    currentAppId: null,
    inputValue: '',
    isLoading: false,
    aiEditContext: null,
    buildErrorContext: null,
    availableAgents: [],
    defaultAgentId: null,
    currentAgentName: null,
    developmentPlan: [],
    appChatHistory: {},
    websocket: createMockWebSocketState(),
    connectionRetry: {
      isRetrying: false,
      retryStartedAt: null,
      wasStreamingOnDisconnect: false,
      disconnectSocketId: null,
      escalationTimeoutId: null
    },
    recoveryState: {
      isRecovering: false,
      expectedEvents: 0,
      receivedEvents: 0
    },
    retryState: {
      isRetrying: false,
      retryCount: 0,
      nextRetryMs: undefined,
      exhausted: false
    },
    // Common actions (as mocks)
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
    startStream: vi.fn(),
    setError: vi.fn(),
    setRecoveryState: vi.fn(),
    setRetryState: vi.fn(),
    startConnectionRetry: vi.fn(),
    clearConnectionRetry: vi.fn(),
    setEscalationTimeout: vi.fn(),
    ...overrides
  }
}

/**
 * Wait for all pending promises to resolve
 * Useful for testing async operations
 */
export async function flushPromises() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Create a spy on console methods for testing logging
 */
export function createConsoleSpy() {
  const spy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    restore: () => {
      spy.log.mockRestore()
      spy.warn.mockRestore()
      spy.error.mockRestore()
    }
  }
  return spy
}

/**
 * Assert that a mock was called with partial arguments
 * Useful when you only care about specific argument properties
 */
export function expectCalledWithPartial<T>(
  mock: Mock,
  expected: Partial<T>,
  callIndex = 0
) {
  const call = mock.mock.calls[callIndex]
  if (!call) {
    throw new Error(`Mock was not called at index ${callIndex}`)
  }

  const actual = call[0]
  for (const key of Object.keys(expected)) {
    expect(actual).toHaveProperty(key, expected[key as keyof T])
  }
}

/**
 * Create a mock visual context for testing
 */
export function createMockVisualContext() {
  return {
    screenshot: 'data:image/png;base64,mock-screenshot',
    viewport: {
      width: 1920,
      height: 1080
    },
    timestamp: Date.now()
  }
}

/**
 * Create mock AI edit context for testing
 */
export function createMockAiEditContext() {
  return {
    elementInfo: {
      tagName: 'div',
      className: 'test-class',
      id: 'test-id'
    },
    selector: '#test-id',
    devContext: {
      url: 'https://example.com',
      viewport: { width: 1920, height: 1080 }
    },
    screenshot: null
  }
}

/**
 * Create mock assets for testing
 */
export function createMockAssets() {
  return [
    {
      mediaType: 'IMAGE' as const,
      sourceType: 'gc',
      imageUrl: 'https://example.com/image1.jpg',
      thumbnailUrl: 'https://example.com/thumb1.jpg',
      filename: 'image1.jpg',
      contentType: 'image/jpeg',
      size: 1024,
      dimensions: { width: 800, height: 600 }
    }
  ]
}
