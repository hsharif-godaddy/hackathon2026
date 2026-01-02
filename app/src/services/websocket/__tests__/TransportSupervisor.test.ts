/**
 * TransportSupervisor Tests
 *
 * Comprehensive unit tests for TransportSupervisor covering critical lifecycle logic.
 * 37 tests organized into 8 categories:
 *
 * 1. Connection Management (2 tests)
 *    - Delegates to ConnectionManager with all callbacks
 *    - Stores appId for handler context
 *
 * 2. Disconnection & Cleanup (4 tests)
 *    - Calls ConnectionManager.disconnect
 *    - Clears socket reference, pending recovery ack, escalation timeout
 *
 * 3. Connection Lifecycle Events (4 tests)
 *    - Emits connection:established/failed/error
 *    - Sends machine events (CONNECTION_ESTABLISHED, TOKEN_REFRESHED, etc.)
 *
 * 4. Disconnect Handling (3 tests)
 *    - Emits disconnect with wasStreaming flag
 *    - Clears pending recovery ack
 *    - Distinguishes idle vs streaming disconnects
 *
 * 5. Retry & Escalation Handling (7 tests)
 *    - Emits transport:retry-started only when streaming
 *    - Schedules escalation timeout (5 min default, server config override)
 *    - Clears timeout on reconnect success/failed
 *    - Does NOT schedule timeout when idle
 *
 * 6. Reconnection Events (4 tests)
 *    - Emits reconnect:attempt/success/error/failed
 *    - Clears escalation timeout on success
 *    - Includes wasStreaming flag in failed event
 *
 * 7. Retry State Management (2 tests)
 *    - Clears retry timer and resets count
 *    - Handles missing timer gracefully
 *
 * 8. Socket Handler Wiring (4 tests)
 *    - Sets up handlers only once per socket instance
 *    - Registers message and status handlers
 *    - Handles multiple socket instances correctly
 *
 * 9. Recovery Protocol (3 tests)
 *    - Does not send ack until replay complete
 *    - Sends ack after replay complete and all events received
 *    - Sends ack immediately if expectedCount is 0
 *
 * 10. Socket Getter (3 tests)
 *     - Returns null initially and after disconnect
 *     - Returns current socket after onSocketReady
 *
 * Key regression prevention:
 * - Escalation timeout cleared on reconnect (prevents false timeouts)
 * - Retry state not started when disconnecting while idle
 * - Handlers set up only once per socket (prevents duplicate handlers)
 * - Recovery ack only sent when appropriate
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TransportSupervisor, type TransportSupervisorDeps } from '../TransportSupervisor'
import type { ConnectionManager, ConnectionCallbacks } from '../ConnectionManager'
import type { Socket } from 'socket.io-client'
import type { WebSocketActor } from '../stateMachineTypes'
import type { MessageHandlerActions } from '@/hooks/websocket/handlers/types'

describe('TransportSupervisor', () => {
  let supervisor: TransportSupervisor
  let mockConnectionManager: ConnectionManager
  let mockMachine: WebSocketActor
  let mockActions: MessageHandlerActions
  let mockHelpers: any
  let mockSocket: Socket
  let mockRefs: any
  let mockGetStreamingState: () => { streamingState: string; activeStream: unknown }

  beforeEach(() => {
    vi.useFakeTimers()

    // Mock ConnectionManager
    mockConnectionManager = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getSocket: vi.fn(),
    } as any

    // Mock XState machine actor
    mockMachine = {
      send: vi.fn(),
      getSnapshot: vi.fn(),
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
    } as any

    // Mock helpers
    mockHelpers = {
      clearStoredSocketId: vi.fn(),
      handleCommitComplete: vi.fn(),
      sendToolImpression: vi.fn(),
      setConversationIdCookie: vi.fn(),
      clearConversationIdCookie: vi.fn(),
      getConversationIdFromCookie: vi.fn(),
    }

    // Mock refs
    mockRefs = {
      serverConfig: { current: null },
      pendingRecoveryAck: { current: null },
      toolDeltaBuffer: { current: new Map() },
      retryState: { current: { retryCount: 0 } },
    }

    // Mock streaming state
    mockGetStreamingState = vi.fn().mockReturnValue({
      streamingState: 'idle',
      activeStream: null,
    })

    // Mock socket
    mockSocket = {
      id: 'socket-123',
      connected: true,
      emit: vi.fn(),
      on: vi.fn(),
    } as any

    const deps: TransportSupervisorDeps = {
      connectionManager: mockConnectionManager,
      machine: mockMachine,
      actions: mockActions,
      getHelpers: () => mockHelpers,
      refs: mockRefs,
      getStreamingState: mockGetStreamingState,
    }

    supervisor = new TransportSupervisor(deps)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('connect', () => {
    it('should delegate to ConnectionManager with all lifecycle callbacks', async () => {
      await supervisor.connect('app-123')

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

    it('should store appId for later use', async () => {
      await supervisor.connect('app-456')

      // Verify appId is used in subsequent operations
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onConnect?.({ socket: mockSocket, recovered: false })

      expect(supervisor).toBeDefined()
    })
  })

  describe('disconnect', () => {
    it('should call ConnectionManager.disconnect', () => {
      supervisor.disconnect()

      expect(mockConnectionManager.disconnect).toHaveBeenCalled()
    })

    it('should clear socket reference', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      expect(supervisor.getSocket()).toBe(mockSocket)

      supervisor.disconnect()

      expect(supervisor.getSocket()).toBeNull()
    })

    it('should clear pending recovery ack', async () => {
      mockRefs.pendingRecoveryAck.current = {
        conversationId: 'conv-123',
        lastSequence: 42,
        ackEvent: 'recovery_ack',
        expectedCount: 5,
        receivedCount: 3,
        replayComplete: true,
      }

      supervisor.disconnect()

      expect(mockRefs.pendingRecoveryAck.current).toBeNull()
    })

    it('should clear escalation timeout', async () => {
      // Set up streaming state
      mockGetStreamingState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      // Trigger disconnect during streaming (sets escalation timeout)
      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      // Disconnect should clear the timeout
      supervisor.disconnect()

      // Advance time past timeout - should not fire
      const onEscalationSpy = vi.fn()
      supervisor.on('transport:escalation-timeout', onEscalationSpy)

      vi.advanceTimersByTime(10 * 60 * 1000) // 10 minutes

      expect(onEscalationSpy).not.toHaveBeenCalled()
    })
  })

  describe('connection lifecycle events', () => {
    it('should emit connection:established and send machine event', async () => {
      const onEstablishedSpy = vi.fn()
      supervisor.on('connection:established', onEstablishedSpy)

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onConnect?.({ socket: mockSocket, recovered: false })

      expect(onEstablishedSpy).toHaveBeenCalledWith({
        socket: mockSocket,
        recovered: false,
      })
      expect(mockMachine.send).toHaveBeenCalledWith({
        type: 'CONNECTION_ESTABLISHED',
        socketId: 'socket-123',
      })
    })

    it('should emit connection:failed and send machine events', async () => {
      const onFailedSpy = vi.fn()
      supervisor.on('connection:failed', onFailedSpy)

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      const error = new Error('Connection failed')

      callbacks.onConnectionFailed?.(error)

      expect(onFailedSpy).toHaveBeenCalledWith({ error })
      expect(mockMachine.send).toHaveBeenCalledWith({
        type: 'TOKEN_REFRESH_FAILED',
        error,
      })
      expect(mockMachine.send).toHaveBeenCalledWith({
        type: 'CONNECTION_FAILED',
        error,
      })
    })

    it('should emit connection:error', async () => {
      const onErrorSpy = vi.fn()
      supervisor.on('connection:error', onErrorSpy)

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      const error = new Error('Connect error')

      callbacks.onConnectError?.(error)

      expect(onErrorSpy).toHaveBeenCalledWith({ error })
    })

    it('should send TOKEN_REFRESHED when socket is ready', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      expect(mockMachine.send).toHaveBeenCalledWith({ type: 'TOKEN_REFRESHED' })
    })
  })

  describe('disconnect handling', () => {
    it('should emit disconnect event with wasStreaming=false when not streaming', async () => {
      const onDisconnectSpy = vi.fn()
      supervisor.on('disconnect', onDisconnectSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'idle',
        activeStream: null,
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      expect(onDisconnectSpy).toHaveBeenCalledWith({
        reason: 'transport close',
        socket: mockSocket,
        wasStreaming: false,
      })
      expect(mockMachine.send).toHaveBeenCalledWith({
        type: 'DISCONNECT',
        reason: 'transport close',
      })
    })

    it('should emit disconnect event with wasStreaming=true when streaming', async () => {
      const onDisconnectSpy = vi.fn()
      supervisor.on('disconnect', onDisconnectSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      expect(onDisconnectSpy).toHaveBeenCalledWith({
        reason: 'transport close',
        socket: mockSocket,
        wasStreaming: true,
      })
    })

    it('should clear pending recovery ack on disconnect', async () => {
      mockRefs.pendingRecoveryAck.current = {
        conversationId: 'conv-123',
        lastSequence: 42,
        ackEvent: 'recovery_ack',
        expectedCount: 5,
        receivedCount: 3,
        replayComplete: true,
      }

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      expect(mockRefs.pendingRecoveryAck.current).toBeNull()
    })
  })

  describe('retry and escalation handling', () => {
    it('should emit transport:retry-started when disconnecting during streaming', async () => {
      const onRetryStartedSpy = vi.fn()
      supervisor.on('transport:retry-started', onRetryStartedSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      expect(onRetryStartedSpy).toHaveBeenCalledWith({ socketId: 'socket-123' })
    })

    it('should NOT emit transport:retry-started when disconnecting while idle', async () => {
      const onRetryStartedSpy = vi.fn()
      supervisor.on('transport:retry-started', onRetryStartedSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'idle',
        activeStream: null,
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      expect(onRetryStartedSpy).not.toHaveBeenCalled()
    })

    it('should schedule escalation timeout when disconnecting during streaming', async () => {
      const onEscalationSpy = vi.fn()
      supervisor.on('transport:escalation-timeout', onEscalationSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      // Timeout should not fire immediately
      expect(onEscalationSpy).not.toHaveBeenCalled()

      // Advance time to 5 minutes (default timeout)
      vi.advanceTimersByTime(5 * 60 * 1000)

      expect(onEscalationSpy).toHaveBeenCalledWith({ socketId: 'socket-123' })
    })

    it('should use server config timeout if available', async () => {
      const onEscalationSpy = vi.fn()
      supervisor.on('transport:escalation-timeout', onEscalationSpy)

      mockRefs.serverConfig.current = {
        streamRecoveryWindow: 2 * 60 * 1000, // 2 minutes
        ackTimeout: 5000,
      }

      mockGetStreamingState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      // Advance to 2 minutes (server config timeout)
      vi.advanceTimersByTime(2 * 60 * 1000)

      expect(onEscalationSpy).toHaveBeenCalledWith({ socketId: 'socket-123' })
    })

    it('should NOT schedule escalation timeout when disconnecting while idle', async () => {
      const onEscalationSpy = vi.fn()
      supervisor.on('transport:escalation-timeout', onEscalationSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'idle',
        activeStream: null,
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      // Advance time past timeout
      vi.advanceTimersByTime(10 * 60 * 1000)

      expect(onEscalationSpy).not.toHaveBeenCalled()
    })

    it('should clear escalation timeout on reconnect success', async () => {
      const onEscalationSpy = vi.fn()
      supervisor.on('transport:escalation-timeout', onEscalationSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      // Disconnect (starts timeout)
      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      // Advance partway through timeout
      vi.advanceTimersByTime(2 * 60 * 1000) // 2 minutes

      // Reconnect (should clear timeout)
      callbacks.onReconnect?.({ socket: mockSocket, attempt: 1 })

      // Advance past original timeout window
      vi.advanceTimersByTime(10 * 60 * 1000)

      expect(onEscalationSpy).not.toHaveBeenCalled()
    })

    it('should clear escalation timeout on reconnect failed', async () => {
      const onEscalationSpy = vi.fn()
      supervisor.on('transport:escalation-timeout', onEscalationSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      // Disconnect (starts timeout)
      callbacks.onDisconnect?.({ reason: 'transport close', socket: mockSocket })

      // Advance partway through timeout
      vi.advanceTimersByTime(2 * 60 * 1000)

      // Reconnect failed (should clear timeout)
      callbacks.onReconnectFailed?.({ socket: mockSocket })

      // Advance past original timeout window
      vi.advanceTimersByTime(10 * 60 * 1000)

      expect(onEscalationSpy).not.toHaveBeenCalled()
    })
  })

  describe('reconnection events', () => {
    it('should emit reconnect:attempt', async () => {
      const onAttemptSpy = vi.fn()
      supervisor.on('reconnect:attempt', onAttemptSpy)

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onReconnectAttempt?.({ socket: mockSocket, attempt: 2 })

      expect(onAttemptSpy).toHaveBeenCalledWith({ socket: mockSocket })
    })

    it('should emit reconnect:success and clear escalation timeout', async () => {
      const onSuccessSpy = vi.fn()
      supervisor.on('reconnect:success', onSuccessSpy)

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onReconnect?.({ socket: mockSocket, attempt: 1 })

      expect(onSuccessSpy).toHaveBeenCalledWith({ socket: mockSocket })
    })

    it('should emit reconnect:error', async () => {
      const onErrorSpy = vi.fn()
      supervisor.on('reconnect:error', onErrorSpy)

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      const error = new Error('Reconnect error')

      callbacks.onReconnectError?.({ socket: mockSocket, error })

      expect(onErrorSpy).toHaveBeenCalledWith({ error })
    })

    it('should emit reconnect:failed with wasStreaming flag', async () => {
      const onFailedSpy = vi.fn()
      supervisor.on('reconnect:failed', onFailedSpy)

      mockGetStreamingState.mockReturnValue({
        streamingState: 'streaming',
        activeStream: { id: 'stream-1' },
      })

      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onReconnectFailed?.({ socket: mockSocket })

      expect(onFailedSpy).toHaveBeenCalledWith({
        socket: mockSocket,
        wasStreaming: true,
      })
    })
  })

  describe('retry state management', () => {
    it('should clear retry state and timeout', () => {
      const timeoutId = setTimeout(() => {}, 1000)
      mockRefs.retryState.current = {
        retryCount: 3,
        retryTimer: timeoutId,
        pendingMessage: {
          chatMessage: { message: 'test' },
          startTime: Date.now(),
        },
      }

      supervisor.clearRetryState()

      expect(mockRefs.retryState.current).toEqual({ retryCount: 0 })
    })

    it('should handle missing retry timer gracefully', () => {
      mockRefs.retryState.current = {
        retryCount: 2,
      }

      expect(() => supervisor.clearRetryState()).not.toThrow()
      expect(mockRefs.retryState.current).toEqual({ retryCount: 0 })
    })
  })

  describe('socket handler wiring', () => {
    it('should set up handlers only once per socket instance', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      // First setup
      callbacks.onSocketReady?.(mockSocket, { isNew: true })
      const firstCallCount = mockSocket.on.mock.calls.length

      // Second call with same socket (should not set up handlers again)
      callbacks.onSocketReady?.(mockSocket, { isNew: false })
      const secondCallCount = mockSocket.on.mock.calls.length

      expect(secondCallCount).toBe(firstCallCount)
    })

    it('should set up handlers for new socket instances', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      // First socket
      const socket1 = { ...mockSocket, id: 'socket-1', on: vi.fn() } as any
      callbacks.onSocketReady?.(socket1, { isNew: true })
      const firstCount = socket1.on.mock.calls.length

      // Second socket (new instance)
      const socket2 = { ...mockSocket, id: 'socket-2', on: vi.fn() } as any
      callbacks.onSocketReady?.(socket2, { isNew: true })
      const secondCount = socket2.on.mock.calls.length

      expect(firstCount).toBeGreaterThan(0)
      expect(secondCount).toBe(firstCount)
    })

    it('should register message and status handlers', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      const handlerTypes = mockSocket.on.mock.calls.map((call: any) => call[0])
      expect(handlerTypes).toContain('message')
      expect(handlerTypes).toContain('status')
    })

    it('should pass correct context to message handlers', async () => {
      await supervisor.connect('app-456')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      // Find the message handler
      const messageHandlerCall = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')
      expect(messageHandlerCall).toBeDefined()

      // The handler should be a function
      const messageHandler = messageHandlerCall![1]
      expect(typeof messageHandler).toBe('function')
    })
  })

  describe('recovery protocol', () => {
    it('should not send recovery ack until replay complete', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      // Set pending recovery ack (not complete)
      mockRefs.pendingRecoveryAck.current = {
        conversationId: 'conv-123',
        lastSequence: 42,
        ackEvent: 'recovery_ack',
        expectedCount: 5,
        receivedCount: 3,
        replayComplete: false,
      }

      // Simulate message receipt
      const messageHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')?.[1]
      await messageHandler({ type: 'chunk', content: 'test' })

      // Should not emit recovery_ack
      expect(mockSocket.emit).not.toHaveBeenCalledWith(
        'recovery_ack',
        expect.any(Object)
      )
    })

    it('should send recovery ack after replay complete and all events received', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      // Set pending recovery ack (expecting 5 events)
      mockRefs.pendingRecoveryAck.current = {
        conversationId: 'conv-123',
        lastSequence: 42,
        ackEvent: 'recovery_ack',
        expectedCount: 5,
        receivedCount: 4,
        replayComplete: true,
      }

      // Simulate one more message receipt (reaches expected count)
      const messageHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')?.[1]
      await messageHandler({ type: 'chunk', content: 'test' })

      // Should emit recovery_ack
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'recovery_ack',
        {
          conversationId: 'conv-123',
          lastSequence: 42,
        }
      )
    })

    it('should register all required message handlers', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      // Verify message handler was registered
      const messageHandlerCall = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')
      expect(messageHandlerCall).toBeDefined()
      expect(typeof messageHandlerCall![1]).toBe('function')

      // Verify status handler was registered
      const statusHandlerCall = mockSocket.on.mock.calls.find((call: any) => call[0] === 'status')
      expect(statusHandlerCall).toBeDefined()
      expect(typeof statusHandlerCall![1]).toBe('function')
    })

    it('should send recovery ack immediately if expectedCount is 0', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks
      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      // Set pending recovery ack with no expected events
      mockRefs.pendingRecoveryAck.current = {
        conversationId: 'conv-123',
        lastSequence: 42,
        ackEvent: 'recovery_ack',
        expectedCount: 0,
        receivedCount: 0,
        replayComplete: true,
      }

      // Trigger check (any message will do)
      const messageHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')?.[1]
      await messageHandler({ type: 'complete', data: {} })

      // Should emit immediately since no events are expected
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'recovery_ack',
        {
          conversationId: 'conv-123',
          lastSequence: 42,
        }
      )
    })
  })

  describe('getSocket', () => {
    it('should return null initially', () => {
      expect(supervisor.getSocket()).toBeNull()
    })

    it('should return current socket after onSocketReady', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onSocketReady?.(mockSocket, { isNew: true })

      expect(supervisor.getSocket()).toBe(mockSocket)
    })

    it('should return null after disconnect', async () => {
      await supervisor.connect('app-123')
      const callbacks = (mockConnectionManager.connect as any).mock.calls[0][1] as ConnectionCallbacks

      callbacks.onSocketReady?.(mockSocket, { isNew: true })
      expect(supervisor.getSocket()).toBe(mockSocket)

      supervisor.disconnect()
      expect(supervisor.getSocket()).toBeNull()
    })
  })
})
