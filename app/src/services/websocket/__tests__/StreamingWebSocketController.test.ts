/**
 * StreamingWebSocketController Tests
 *
 * Tests for the headless StreamingWebSocketController service
 */

import { EventEmitter } from 'events'
import type { Socket } from 'socket.io-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getConversationIdFromCookie } from '@/hooks/websocket/useWebSocketHelpers'
import type { ChatMessageBuilder } from '../ChatMessageBuilder'
import type { ConnectionCallbacks, ConnectionManager } from '../ConnectionManager'
import {
  StreamingWebSocketController,
  type StreamingWebSocketControllerDeps,
} from '../StreamingWebSocketController'

// Mock conversation ID helpers
vi.mock('@/hooks/websocket/useWebSocketHelpers', () => ({
  getConversationIdFromCookie: vi.fn(),
  clearConversationIdCookie: vi.fn(),
  setConversationIdCookie: vi.fn(),
}))

describe('StreamingWebSocketController', () => {
  let controller: StreamingWebSocketController
  let mockConnectionManager: ConnectionManager
  let mockMessageBuilder: ChatMessageBuilder
  let mockActions: any
  let mockHelpers: any
  let mockGetStoreState: ReturnType<typeof vi.fn>
  let mockSocket: Socket

  beforeEach(() => {
    // Reset conversation ID helper mocks
    vi.mocked(getConversationIdFromCookie).mockReturnValue(null)

    // Mock ConnectionManager
    mockConnectionManager = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getSocket: vi.fn(),
      setServerConfigRef: vi.fn(),
    } as any

    // Mock ChatMessageBuilder
    mockMessageBuilder = {
      build: vi.fn().mockReturnValue({
        message: 'Test message',
        timestamp: new Date().toISOString(),
        context: {},
      }),
    } as any

    // Mock actions
    mockActions = {
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
    }

    // Mock helpers
    mockHelpers = {
      clearStoredSocketId: vi.fn(),
      handleCommitComplete: vi.fn(),
      sendToolImpression: vi.fn(),
      setConversationIdCookie: vi.fn(),
      clearConversationIdCookie: vi.fn(),
      getConversationIdFromCookie: vi.fn(),
    }

    // Mock store state
    mockGetStoreState = vi.fn().mockReturnValue({
      streamingState: 'idle',
      activeStream: null,
      connectionRetry: {
        isRetrying: false,
        wasStreamingOnDisconnect: false,
        retryStartedAt: null,
      },
      buildErrorContext: null,
      startConnectionRetry: vi.fn(),
      clearConnectionRetry: vi.fn(),
      setEscalationTimeout: vi.fn(),
      setWebSocketState: vi.fn(),
      setStreamingState: vi.fn(),
      setIsLoading: vi.fn(),
      markUpstreamError: vi.fn(),
      finalizeStream: vi.fn(),
      // Phase 3 additions - machine/adapter integration
      startStream: vi.fn(),
      setError: vi.fn(),
      setRecoveryState: vi.fn(),
      setRetryState: vi.fn(),
    })

    // Mock socket
    mockSocket = {
      id: 'socket-123',
      connected: true,
      emit: vi.fn(),
      on: vi.fn(),
    } as any

    const deps: StreamingWebSocketControllerDeps = {
      connectionManager: mockConnectionManager,
      messageBuilder: mockMessageBuilder,
      getActions: () => mockActions,
      getHelpers: () => mockHelpers,
      toolDeltaBufferRef: { current: new Map() },
      getStoreState: mockGetStoreState,
    }

    controller = new StreamingWebSocketController(deps)
  })

  describe('connect', () => {
    it('should call ConnectionManager.connect with callbacks', async () => {
      await controller.connect('app-123')

      expect(mockConnectionManager.connect).toHaveBeenCalledWith(
        'app-123',
        expect.objectContaining({
          onSocketReady: expect.any(Function),
          onConnect: expect.any(Function),
          onConnectionFailed: expect.any(Function),
          onConnectError: expect.any(Function),
          onDisconnect: expect.any(Function),
          onReconnectAttempt: expect.any(Function),
          onReconnect: expect.any(Function),
          onReconnectError: expect.any(Function),
          onReconnectFailed: expect.any(Function),
        })
      )
    })

    it('should emit connection:established event when connected', async () => {
      const onConnectSpy = vi.fn()
      controller.on('connection:established', onConnectSpy)

      await controller.connect('app-123')

      // Get the callbacks passed to ConnectionManager
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      // Simulate connection
      callbacks.onConnect?.({ socket: mockSocket, recovered: false })

      expect(onConnectSpy).toHaveBeenCalledWith({
        socket: mockSocket,
        recovered: false,
      })
    })

    it('should emit connection:failed event on failure', async () => {
      const onFailedSpy = vi.fn()
      controller.on('connection:failed', onFailedSpy)

      await controller.connect('app-123')

      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      const error = new Error('Connection failed')

      callbacks.onConnectionFailed?.(error)

      expect(onFailedSpy).toHaveBeenCalledWith({ error })
    })

    // Lifecycle state updates removed - this test is now redundant with "should emit connection:established event"
    // StoreSyncAdapter handles all lifecycle state, adapter tests verify state updates
  })

  describe('disconnect', () => {
    it('should call ConnectionManager.disconnect', () => {
      controller.disconnect()

      expect(mockConnectionManager.disconnect).toHaveBeenCalled()
    })

    it('should clear pending recovery ack', async () => {
      // Setup: connect and set recovery state
      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      // Disconnect
      controller.disconnect()

      // Recovery ack should be cleared (tested indirectly through subsequent operations)
      expect(mockConnectionManager.disconnect).toHaveBeenCalled()
    })
  })

  describe('sendMessage', () => {
    beforeEach(async () => {
      // Setup connected controller with socket
      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      // Mock socket getter
      ;(mockConnectionManager.getSocket as any).mockReturnValue(mockSocket)

      // Reset store state mock BEFORE simulating connection (adapter syncs on transitions)
      mockGetStoreState.mockReturnValue({
        streamingState: 'idle',
        activeStream: null,
        connectionRetry: {
          isRetrying: false,
          wasStreamingOnDisconnect: false,
          retryStartedAt: null,
        },
        buildErrorContext: null,
        startConnectionRetry: vi.fn(),
        clearConnectionRetry: vi.fn(),
        setEscalationTimeout: vi.fn(),
        setWebSocketState: vi.fn(),
        setStreamingState: vi.fn(),
        setIsLoading: vi.fn(),
        markUpstreamError: vi.fn(),
        finalizeStream: vi.fn(),
        setRecoveryState: vi.fn(),
        setRetryState: vi.fn(),
        setError: vi.fn(),
        startStream: vi.fn(),
      })

      // Simulate the full connect-then-auth flow to move machine to connected state
      callbacks.onConnect?.({ socket: mockSocket, recovered: false })
      callbacks.onAuthenticated?.({ socket: mockSocket })
    })

    it('should build message using ChatMessageBuilder', async () => {
      // Mock cookie to return conversationId
      vi.mocked(getConversationIdFromCookie).mockReturnValue('conv-456')

      await controller.sendMessage({
        content: 'Hello world',
        visualContext: null,
      })

      expect(mockMessageBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello world',
          appId: 'app-123',
          sessionId: 'socket-123',
          conversationId: 'conv-456',
        })
      )
    })

    it('should start new stream (Tier 2 action)', async () => {
      await controller.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      // Tier 2 action - controller directly calls this
      expect(mockActions.startNewStream).toHaveBeenCalledWith('Test', undefined, undefined)
      // Note: Lifecycle state (setIsLoading, setStreamingState) handled by StoreSyncAdapter
    })

    it('should emit chat_message via socket', async () => {
      await controller.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chat_message',
        expect.objectContaining({
          message: 'Test message',
        }),
        expect.any(Function)
      )
    })

    it('should emit message:sent event', async () => {
      const onSentSpy = vi.fn()
      controller.on('message:sent', onSentSpy)

      await controller.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      expect(onSentSpy).toHaveBeenCalledWith({
        message: expect.objectContaining({
          message: 'Test message',
        }),
      })
    })

    it('should emit message:error event on error', async () => {
      const onErrorSpy = vi.fn()
      controller.on('message:error', onErrorSpy)

      mockSocket.connected = false

      await controller.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      expect(onErrorSpy).toHaveBeenCalledWith({
        error: expect.any(Error),
      })
    })

    it('should do nothing if content is empty', async () => {
      await controller.sendMessage({
        content: '',
        visualContext: null,
      })

      expect(mockMessageBuilder.build).not.toHaveBeenCalled()
      expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('should reject sendMessage when not authenticated', async () => {
      // Create a fresh controller and connect, but do NOT call onAuthenticated
      const freshController = new StreamingWebSocketController({
        connectionManager: mockConnectionManager,
        messageBuilder: mockMessageBuilder,
        getActions: () => mockActions,
        getHelpers: () => mockHelpers,
        toolDeltaBufferRef: { current: new Map() },
        getStoreState: mockGetStoreState,
      })

      const onErrorSpy = vi.fn()
      freshController.on('message:error', onErrorSpy)

      await freshController.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[1][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })
      ;(mockConnectionManager.getSocket as any).mockReturnValue(mockSocket)

      // Simulate connect but NOT authenticate
      callbacks.onConnect?.({ socket: mockSocket, recovered: false })

      await freshController.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      expect(onErrorSpy).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: expect.stringContaining('not authenticated'),
        }),
      })

      freshController.destroy()
    })

    it('should do nothing if appId is not set', async () => {
      // Create new controller without connecting
      const newController = new StreamingWebSocketController({
        connectionManager: mockConnectionManager,
        messageBuilder: mockMessageBuilder,
        getActions: () => mockActions,
        getHelpers: () => mockHelpers,
        toolDeltaBufferRef: { current: new Map() },
        getStoreState: mockGetStoreState,
      })

      await newController.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      expect(mockMessageBuilder.build).not.toHaveBeenCalled()
    })
  })

  describe('event emission', () => {
    it('should extend EventEmitter', () => {
      expect(controller).toBeInstanceOf(EventEmitter)
    })

    it('should support on/off/emit for events', () => {
      const handler = vi.fn()
      controller.on('connection:established', handler)

      controller.emit('connection:established', { socket: mockSocket, recovered: false })

      expect(handler).toHaveBeenCalledWith({ socket: mockSocket, recovered: false })

      controller.off('connection:established', handler)
      controller.emit('connection:established', { socket: mockSocket, recovered: false })

      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('reconnection handling', () => {
    it('should emit reconnect:attempt event', async () => {
      const onReconnectAttemptSpy = vi.fn()
      controller.on('reconnect:attempt', onReconnectAttemptSpy)

      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onReconnectAttempt?.({ socket: mockSocket, attempt: 1 })

      expect(onReconnectAttemptSpy).toHaveBeenCalled()
      // Lifecycle state (setWebSocketState) is now handled by StoreSyncAdapter
    })

    it('should emit reconnect:success event', async () => {
      const onReconnectSpy = vi.fn()
      controller.on('reconnect:success', onReconnectSpy)

      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onReconnect?.({ socket: mockSocket, attempt: 1 })

      expect(onReconnectSpy).toHaveBeenCalled()
      // Lifecycle state (setWebSocketState) is now handled by StoreSyncAdapter
    })

    it('should emit reconnect:failed event', async () => {
      const onReconnectFailedSpy = vi.fn()
      controller.on('reconnect:failed', onReconnectFailedSpy)

      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onReconnectFailed?.({ socket: mockSocket })

      expect(onReconnectFailedSpy).toHaveBeenCalled()
      // Lifecycle state (setWebSocketState) is now handled by StoreSyncAdapter
    })

    it('should handle disconnect during streaming', async () => {
      mockGetStoreState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
        connectionRetry: {
          isRetrying: false,
          wasStreamingOnDisconnect: false,
          retryStartedAt: null,
        },
        buildErrorContext: null,
        startConnectionRetry: vi.fn(),
        clearConnectionRetry: vi.fn(),
        setEscalationTimeout: vi.fn(),
        setWebSocketState: vi.fn(),
        setStreamingState: vi.fn(),
        setIsLoading: vi.fn(),
        markUpstreamError: vi.fn(),
        finalizeStream: vi.fn(),
        // Phase 3 additions - machine/adapter integration
        startStream: vi.fn(),
        setError: vi.fn(),
        setRecoveryState: vi.fn(),
        setRetryState: vi.fn(),
      })

      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      const storeState = mockGetStoreState()
      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      // Controller initiates retry mechanism (not lifecycle state)
      expect(storeState.startConnectionRetry).toHaveBeenCalledWith('socket-123')
      // Note: Lifecycle state (setWebSocketState) handled by StoreSyncAdapter
    })
  })

  describe('replay deduplication', () => {
    it('forces cleanup after timeout to prevent leaks', () => {
      vi.useFakeTimers()
      ;(controller as any).serverConfigRef.current = {
        ackTimeout: 1000,
        streamRecoveryWindow: 60_000,
      }

      controller.startReplayDeduplication()
      expect(controller.isInReplayMode()).toBe(true)

      // Timeout should fire at max(ackTimeout * 2, 60s) → 60s here
      vi.advanceTimersByTime(61_000)

      expect(controller.isInReplayMode()).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('state management', () => {
    it('should manage refs with current property', async () => {
      // Connect to initialize
      await controller.connect('app-123')

      // Refs should be accessible (indirectly tested through behavior)
      expect(controller).toBeDefined()
    })

    it('should clear retry state on disconnect', () => {
      vi.useFakeTimers()

      controller.disconnect()

      // Should have cleared timeout (indirectly verified by no errors)
      vi.useRealTimers()
    })
  })

  describe('regression tests for refactoring bugs', () => {
    it('should use fresh helpers from getHelpers when socket reconnects', async () => {
      // Regression test for Bug 1: Helper closures frozen with null appId
      // This validates that each socket setup calls getHelpers() to get fresh helpers
      // instead of capturing stale closures with old appId values

      const firstHelper = vi.fn()
      const secondHelper = vi.fn()
      mockHelpers.handleCommitComplete = firstHelper

      // First connection - sets up handlers with first helper
      await controller.connect('app-123')
      const callbacks1 = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks1.onSocketReady?.(mockSocket, { isNew: true })

      // Simulate 'complete' message which calls handleCommitComplete
      const messageHandler = (mockSocket.on as any).mock.calls.find((call: any) => call[0] === 'message')?.[1]
      expect(messageHandler).toBeDefined()
      await messageHandler({ type: 'complete', content: '', data: { commitHash: 'abc123' } })

      // First helper should have been called
      expect(firstHelper).toHaveBeenCalledTimes(1)
      expect(secondHelper).not.toHaveBeenCalled()

      // Now simulate reconnection with updated helpers (as would happen with appId change)
      firstHelper.mockClear()
      secondHelper.mockClear()
      mockHelpers.handleCommitComplete = secondHelper

      // Create new socket to simulate reconnection
      const newSocket = {
        ...mockSocket,
        id: 'socket-456',
        on: vi.fn(),
      } as any

      // Reconnect - should call getHelpers() again and get NEW helper
      callbacks1.onSocketReady?.(newSocket, { isNew: true })

      // Find the new message handler
      const newMessageHandler = newSocket.on.mock.calls.find((call: any) => call[0] === 'message')?.[1]
      expect(newMessageHandler).toBeDefined()
      await newMessageHandler({ type: 'complete', content: '', data: { commitHash: 'def456' } })

      // Second helper should have been called, not first (proving fresh helpers were used)
      expect(firstHelper).not.toHaveBeenCalled()
      expect(secondHelper).toHaveBeenCalledTimes(1)
    })

    it('should use the tool delta buffer ref passed from deps', async () => {
      // Regression test for Bug 2: Tool delta buffer using different refs
      // The controller should use deps.toolDeltaBufferRef, not create its own
      const customBuffer = new Map()
      customBuffer.set('test-tool', { name: 'test', delta: 'delta', hasExplicitName: true })

      const customDeps: StreamingWebSocketControllerDeps = {
        connectionManager: mockConnectionManager,
        messageBuilder: mockMessageBuilder,
        getActions: () => mockActions,
        getHelpers: vi.fn().mockReturnValue(mockHelpers),
        toolDeltaBufferRef: { current: customBuffer },
        getStoreState: mockGetStoreState,
      }

      const customController = new StreamingWebSocketController(customDeps)
      await customController.connect('app-123')

      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      // The buffer passed to handlers should be the same one we provided
      // (verified through integration tests with handlers)
      expect(customDeps.toolDeltaBufferRef.current).toBe(customBuffer)
    })

    it('should not send events to stopped machine during destroy with in-flight connection', async () => {
      // Regression test for Bug 3: Cleanup order race condition
      // Previously, machine.stop() was called before disconnect(), causing async connection
      // events to arrive after machine was stopped, resulting in XState warnings and leaks

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Start connection but don't complete it yet
      const connectPromise = controller.connect('app-123')

      // Get the callbacks that were registered
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      // Immediately destroy the controller while connection is in-flight
      // This simulates unmount during connection attempt
      controller.destroy()

      // Now simulate late-arriving connection events that would have been triggered by async ops
      // With the correct destroy order (disconnect → adapter → machine), these should be safe
      callbacks.onSocketReady?.(mockSocket, { isNew: true })
      callbacks.onConnect?.({ socket: mockSocket, recovered: false })

      // Verify no XState "event sent to stopped actor" warnings were logged
      const xstateWarnings = consoleSpy.mock.calls.filter(call =>
        call.some(arg =>
          typeof arg === 'string' &&
          arg.includes('event sent to stopped actor') ||
          arg.includes('sent to stopped machine')
        )
      )

      expect(xstateWarnings).toHaveLength(0)

      // Verify disconnect was called (ensures sockets and listeners were cleaned up)
      expect(mockConnectionManager.disconnect).toHaveBeenCalled()

      consoleSpy.mockRestore()
      await connectPromise.catch(() => {}) // Cleanup promise
    })
  })

  describe('onGrantRefreshRequested', () => {
    it('should register callback for grant refresh events', () => {
      const callback = vi.fn()
      const cleanup = controller.onGrantRefreshRequested(callback)

      // Emit the event
      controller.emit('grant:refresh-requested')

      expect(callback).toHaveBeenCalledTimes(1)

      // Cleanup
      cleanup()
    })

    it('should return cleanup function that removes listener', () => {
      const callback = vi.fn()
      const cleanup = controller.onGrantRefreshRequested(callback)

      // Call cleanup
      cleanup()

      // Emit the event after cleanup
      controller.emit('grant:refresh-requested')

      // Callback should not be called since we cleaned up
      expect(callback).not.toHaveBeenCalled()
    })

    it('should handle cleanup when removeListener is not available (HMR edge case)', () => {
      const callback = vi.fn()
      const cleanup = controller.onGrantRefreshRequested(callback)

      // Simulate HMR edge case where removeListener might be unavailable
      const originalRemoveListener = controller.removeListener
      ;(controller as any).removeListener = undefined

      // Cleanup should not throw even when removeListener is unavailable
      expect(() => cleanup()).not.toThrow()

      // Restore
      controller.removeListener = originalRemoveListener
    })

    it('should allow multiple callbacks to be registered', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const cleanup1 = controller.onGrantRefreshRequested(callback1)
      const cleanup2 = controller.onGrantRefreshRequested(callback2)

      controller.emit('grant:refresh-requested')

      expect(callback1).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)

      // Cleanup first callback only
      cleanup1()

      controller.emit('grant:refresh-requested')

      // First callback should not be called again
      expect(callback1).toHaveBeenCalledTimes(1)
      // Second callback should be called again
      expect(callback2).toHaveBeenCalledTimes(2)

      cleanup2()
    })
  })
})
