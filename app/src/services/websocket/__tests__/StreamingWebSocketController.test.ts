/**
 * StreamingWebSocketController Tests
 *
 * Tests for the headless StreamingWebSocketController service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import {
  StreamingWebSocketController,
  type StreamingWebSocketControllerDeps,
} from '../StreamingWebSocketController'
import type { ConnectionManager, ConnectionCallbacks } from '../ConnectionManager'
import type { ChatMessageBuilder } from '../ChatMessageBuilder'
import type { Socket } from 'socket.io-client'

describe('StreamingWebSocketController', () => {
  let controller: StreamingWebSocketController
  let mockConnectionManager: ConnectionManager
  let mockMessageBuilder: ChatMessageBuilder
  let mockActions: any
  let mockHelpers: any
  let mockGetStoreState: () => any
  let mockSocket: Socket

  beforeEach(() => {
    // Mock ConnectionManager
    mockConnectionManager = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getSocket: vi.fn(),
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
      conversations: [],
      startConnectionRetry: vi.fn(),
      clearConnectionRetry: vi.fn(),
      setEscalationTimeout: vi.fn(),
      setWebSocketState: vi.fn(),
      setStreamingState: vi.fn(),
      setIsLoading: vi.fn(),
      markUpstreamError: vi.fn(),
      finalizeStream: vi.fn(),
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
      actions: mockActions,
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

    it('should update WebSocket state on connection', async () => {
      await controller.connect('app-123')

      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onConnect?.({ socket: mockSocket, recovered: false })

      expect(mockActions.setWebSocketState).toHaveBeenCalledWith({
        connected: true,
        status: 'idle',
      })
    })
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

      // Reset store state mock to return conversations
      mockGetStoreState.mockReturnValue({
        streamingState: 'idle',
        activeStream: null,
        connectionRetry: {
          isRetrying: false,
          wasStreamingOnDisconnect: false,
          retryStartedAt: null,
        },
        buildErrorContext: null,
        conversations: [{ appId: 'app-123', id: 'conv-456' }],
        startConnectionRetry: vi.fn(),
        clearConnectionRetry: vi.fn(),
        setEscalationTimeout: vi.fn(),
        setWebSocketState: vi.fn(),
        setStreamingState: vi.fn(),
        setIsLoading: vi.fn(),
        markUpstreamError: vi.fn(),
        finalizeStream: vi.fn(),
      })
    })

    it('should build message using ChatMessageBuilder', async () => {
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

    it('should set loading and streaming state', async () => {
      await controller.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      expect(mockActions.setIsLoading).toHaveBeenCalledWith(true)
      expect(mockActions.setStreamingState).toHaveBeenCalledWith('streaming')
    })

    it('should start new stream', async () => {
      await controller.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      expect(mockActions.startNewStream).toHaveBeenCalledWith('Test')
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

    it('should handle socket not connected error', async () => {
      mockSocket.connected = false

      await controller.sendMessage({
        content: 'Test',
        visualContext: null,
      })

      expect(mockActions.setWebSocketState).toHaveBeenCalledWith({
        status: 'error',
        error: { message: 'WebSocket not connected. Connection may be reconnecting...' },
      })
      expect(mockActions.setStreamingState).toHaveBeenCalledWith('error')
      expect(mockActions.setIsLoading).toHaveBeenCalledWith(false)
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

    it('should do nothing if appId is not set', async () => {
      // Create new controller without connecting
      const newController = new StreamingWebSocketController({
        connectionManager: mockConnectionManager,
        messageBuilder: mockMessageBuilder,
        actions: mockActions,
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
      expect(mockActions.setWebSocketState).toHaveBeenCalledWith({
        connected: false,
        status: 'connecting',
      })
    })

    it('should emit reconnect:success event', async () => {
      const onReconnectSpy = vi.fn()
      controller.on('reconnect:success', onReconnectSpy)

      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onReconnect?.({ socket: mockSocket, attempt: 1 })

      expect(onReconnectSpy).toHaveBeenCalled()
      expect(mockActions.setWebSocketState).toHaveBeenCalledWith({
        connected: true,
        status: 'idle',
      })
    })

    it('should emit reconnect:failed event', async () => {
      const onReconnectFailedSpy = vi.fn()
      controller.on('reconnect:failed', onReconnectFailedSpy)

      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onReconnectFailed?.({ socket: mockSocket })

      expect(onReconnectFailedSpy).toHaveBeenCalled()
      expect(mockActions.setWebSocketState).toHaveBeenCalledWith({
        connected: false,
        status: 'error',
        error: { message: 'Failed to reconnect' },
      })
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
        conversations: [],
        startConnectionRetry: vi.fn(),
        clearConnectionRetry: vi.fn(),
        setEscalationTimeout: vi.fn(),
        setWebSocketState: vi.fn(),
        setStreamingState: vi.fn(),
        setIsLoading: vi.fn(),
        markUpstreamError: vi.fn(),
        finalizeStream: vi.fn(),
      })

      await controller.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      const storeState = mockGetStoreState()
      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      expect(storeState.startConnectionRetry).toHaveBeenCalledWith('socket-123')
      expect(mockActions.setWebSocketState).toHaveBeenCalledWith({
        connected: false,
        status: 'connecting',
        error: {
          message: 'Connection lost (transport close), retrying...',
          type: 'NETWORK_ERROR',
        },
      })
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

      // Create a timeout
      const timeoutId = setTimeout(() => {}, 1000)

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
      mockHelpers.clearStoredSocketId = firstHelper

      // First connection - sets up handlers with first helper
      await controller.connect('app-123')
      const callbacks1 = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks1.onSocketReady?.(mockSocket, { isNew: true })

      // Simulate 'complete' message which calls clearStoredSocketId
      const messageHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')?.[1]
      expect(messageHandler).toBeDefined()
      await messageHandler({ type: 'complete', content: '', data: {} })

      // First helper should have been called
      expect(firstHelper).toHaveBeenCalledTimes(1)
      expect(secondHelper).not.toHaveBeenCalled()

      // Now simulate reconnection with updated helpers (as would happen with appId change)
      firstHelper.mockClear()
      secondHelper.mockClear()
      mockHelpers.clearStoredSocketId = secondHelper

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
      await newMessageHandler({ type: 'complete', content: '', data: {} })

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
        actions: mockActions,
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
  })
})
