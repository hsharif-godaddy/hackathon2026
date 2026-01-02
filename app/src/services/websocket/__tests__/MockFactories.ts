/**
 * Mock Factories
 *
 * Factory functions for creating mock objects used in tests.
 */

import { vi } from 'vitest'
import type { ServerConfig } from '@/hooks/websocket/handlers/types'

export function createMockConnectionManager() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getSocket: vi.fn(),
    refreshToken: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(false),
  }
}

export function createMockChatMessageBuilder() {
  return {
    buildMessage: vi.fn().mockReturnValue({}),
    addContext: vi.fn(),
  }
}

export function createMockSocket() {
  return {
    on: vi.fn(),
    emit: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
    id: 'mock-socket-id',
  }
}

export function createMockServerConfig(): ServerConfig {
  return {
    streamRecoveryWindow: 30000,
    ackTimeout: 5000,
  }
}

export function createMockStore() {
  return {
    // Lifecycle actions (Tier 1)
    setWebSocketState: vi.fn(),
    startStream: vi.fn(),
    finalizeStream: vi.fn(),
    setError: vi.fn(),
    setRecoveryState: vi.fn(),
    setRetryState: vi.fn(),
    setStreamingState: vi.fn(),
    setIsLoading: vi.fn(),
    markUpstreamError: vi.fn(),

    // Application-level actions
    startConnectionRetry: vi.fn(),
    clearConnectionRetry: vi.fn(),
    setEscalationTimeout: vi.fn(),

    // State properties
    connectionRetry: {
      isRetrying: false,
      retryStartedAt: null,
      wasStreamingOnDisconnect: false,
      escalationTimeoutId: null,
    },
    activeStream: null,

    // Transcript data actions (Tier 2)
    appendChunk: vi.fn(),
    updateToolDelta: vi.fn(),
    addToolCall: vi.fn(),
    updateToolCall: vi.fn(),
    setToolResult: vi.fn(),
    addStep: vi.fn(),
    completeStep: vi.fn(),
  }
}

export function createMockTransportSupervisor() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    getSocket: vi.fn().mockReturnValue(null),
    clearRetryState: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
  }
}
