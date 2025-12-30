import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConnectionRecoveryManager,
  type ConnectionRecoveryManagerConfig,
  type ConnectionRecoveryManagerDependencies
} from '../connection-recovery-manager.js'
import { ConnectionStateManager } from '../connection-state-manager.js'
import type { ConversationEventChannel } from '../conversation-event-channel.js'
import type { DisconnectedStreamState } from '../subscribers/websocket-subscriber.js'
import type { StreamingEvent } from '../interfaces.js'

// Mock Socket.IO socket
const createMockSocket = (overrides: Partial<{
  id: string
  recovered: boolean
  handshake: { auth: Record<string, unknown> }
}> = {}) => {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {}
  const onceHandlers: Record<string, Array<(...args: any[]) => void>> = {}

  return {
    id: overrides.id ?? 'socket-123',
    recovered: overrides.recovered ?? false,
    handshake: overrides.handshake ?? { auth: {} },
    emit: vi.fn(),
    on: vi.fn((event, handler) => {
      handlers[event] = handlers[event] || []
      handlers[event]!.push(handler)
    }),
    once: vi.fn((event, handler) => {
      onceHandlers[event] = onceHandlers[event] || []
      onceHandlers[event]!.push(handler)
    }),
    off: vi.fn((event, handler) => {
      if (handlers[event]) {
        handlers[event] = handlers[event]!.filter(h => h !== handler)
      }
      if (onceHandlers[event]) {
        onceHandlers[event] = onceHandlers[event]!.filter(h => h !== handler)
      }
    }),
    // Test helpers
    trigger: (event: string, ...args: any[]) => {
      const allHandlers = [...(handlers[event] || []), ...(onceHandlers[event] || [])]
      // Clear once handlers after triggering
      onceHandlers[event] = []
      allHandlers.forEach(handler => handler(...args))
    },
    getOnceHandlers: () => onceHandlers
  } as any
}

// Mock event channel
const createMockEventChannel = () => ({
  getEventsSince: vi.fn().mockReturnValue([]),
  getMetadata: vi.fn().mockReturnValue(null),
  subscribe: vi.fn(),
  unsubscribe: vi.fn()
})

describe('ConnectionRecoveryManager', () => {
  let manager: ConnectionRecoveryManager
  let stateManager: ConnectionStateManager
  let eventChannel: ReturnType<typeof createMockEventChannel>
  let disconnectedStreams: Map<string, DisconnectedStreamState>
  let config: ConnectionRecoveryManagerConfig
  let mockLogger: any

  beforeEach(() => {
    vi.useFakeTimers()

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }

    stateManager = new ConnectionStateManager(
      { recoveryWindow: 5 * 60 * 1000, ackTimeout: 30_000 },
      mockLogger
    )

    eventChannel = createMockEventChannel()
    disconnectedStreams = new Map()

    config = {
      ackTimeout: 30_000,
      recoveryWindow: 5 * 60 * 1000
    }

    const dependencies: ConnectionRecoveryManagerDependencies = {
      stateManager,
      eventChannel: eventChannel as unknown as ConversationEventChannel,
      disconnectedStreams,
      logger: mockLogger
    }

    manager = new ConnectionRecoveryManager(dependencies, config)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('attemptRecovery', () => {
    it('returns automatic for recovered socket with disconnected stream', () => {
      const socket = createMockSocket({
        id: 'socket-1',
        recovered: true
      })

      disconnectedStreams.set('socket-1', {
        abortController: new AbortController(),
        timeoutId: setTimeout(() => {}, 1000),
        conversationId: 'conv-1',
        lastDeliveredSequence: 10
      })

      const mode = manager.attemptRecovery(socket)
      expect(mode).toBe('automatic')
    })

    it('returns manual for socket with previousSocketId', () => {
      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { previousSocketId: 'socket-old' } }
      })

      disconnectedStreams.set('socket-old', {
        abortController: new AbortController(),
        timeoutId: setTimeout(() => {}, 1000),
        conversationId: 'conv-1',
        lastDeliveredSequence: 10
      })

      const mode = manager.attemptRecovery(socket)
      expect(mode).toBe('manual')
    })

    it('returns conversation for socket with conversationId cookie', () => {
      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { conversationId: 'conv-1' } }
      })

      disconnectedStreams.set('socket-old', {
        abortController: new AbortController(),
        timeoutId: setTimeout(() => {}, 1000),
        conversationId: 'conv-1',
        lastDeliveredSequence: 10
      })

      const mode = manager.attemptRecovery(socket)
      expect(mode).toBe('conversation')
    })

    it('returns null for fresh connection', () => {
      const socket = createMockSocket({ id: 'socket-new' })

      const mode = manager.attemptRecovery(socket)
      expect(mode).toBeNull()
    })

    it('returns null when previousSocketId not found', () => {
      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { previousSocketId: 'socket-nonexistent' } }
      })

      const mode = manager.attemptRecovery(socket)
      expect(mode).toBeNull()
    })
  })

  describe('handleAutomaticRecovery', () => {
    let socket: ReturnType<typeof createMockSocket>
    let callbacks: any

    beforeEach(() => {
      socket = createMockSocket({
        id: 'socket-1',
        recovered: true
      })

      callbacks = {
        onRecoveryComplete: vi.fn(),
        onRecoveryFailed: vi.fn(),
        createWebSocketSubscriber: vi.fn().mockReturnValue({
          id: 'websocket-socket-1'
        })
      }

      // Set up state
      stateManager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'test-agent',
        context: { socketId: 'socket-1', agentName: 'test-agent' }
      })
      stateManager.transitionTo('socket-1', 'disconnected')

      disconnectedStreams.set('socket-1', {
        abortController: new AbortController(),
        timeoutId: setTimeout(() => {}, 1000),
        conversationId: 'conv-1',
        lastDeliveredSequence: 5
      })
    })

    it('sends recovery_status with buffered events info', async () => {
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 6,
          type: 'chunk',
          content: 'hello',
          data: {},
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]
      eventChannel.getEventsSince.mockReturnValue(events)

      await manager.handleAutomaticRecovery(socket, callbacks)

      expect(socket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'recovery_status',
        data: expect.objectContaining({
          isRecovering: true,
          hasBufferedEvents: true,
          bufferedEventCount: 1,
          recoveryMode: 'automatic',
          requiresAck: true
        })
      }))
    })

    it('replays buffered events', async () => {
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 6,
          type: 'chunk',
          content: 'hello',
          data: { key: 'value' },
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]
      eventChannel.getEventsSince.mockReturnValue(events)

      await manager.handleAutomaticRecovery(socket, callbacks)

      expect(socket.emit).toHaveBeenCalledWith('message', {
        type: 'chunk',
        content: 'hello',
        data: { key: 'value' }
      })
    })

    it('sends replay_complete after events', async () => {
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 6,
          type: 'chunk',
          content: 'hello',
          data: {},
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]
      eventChannel.getEventsSince.mockReturnValue(events)

      await manager.handleAutomaticRecovery(socket, callbacks)

      expect(socket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'replay_complete',
        data: expect.objectContaining({
          lastSequence: 6,
          eventsReplayed: 1
        })
      }))
    })

    it('calls onRecoveryComplete after ACK received', async () => {
      eventChannel.getEventsSince.mockReturnValue([])

      await manager.handleAutomaticRecovery(socket, callbacks)

      // Simulate client ACK
      socket.trigger('recovery_ack', {
        conversationId: 'conv-1',
        lastSequence: 5
      })

      expect(callbacks.onRecoveryComplete).toHaveBeenCalledWith(
        'socket-1',
        []
      )
    })

    it('calls onRecoveryFailed after ACK timeout', async () => {
      eventChannel.getEventsSince.mockReturnValue([])

      await manager.handleAutomaticRecovery(socket, callbacks)

      // Advance past ACK timeout
      vi.advanceTimersByTime(config.ackTimeout + 1000)

      expect(callbacks.onRecoveryFailed).toHaveBeenCalledWith(
        'socket-1',
        'ack_timeout'
      )
    })

    it('ignores ACK with wrong conversationId', async () => {
      eventChannel.getEventsSince.mockReturnValue([])

      await manager.handleAutomaticRecovery(socket, callbacks)

      // Simulate client ACK with wrong conversationId
      socket.trigger('recovery_ack', {
        conversationId: 'wrong-conv',
        lastSequence: 5
      })

      expect(callbacks.onRecoveryComplete).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'recovery.ack_mismatch',
        expect.any(Object)
      )
    })
  })

  describe('handleManualRecovery', () => {
    let socket: ReturnType<typeof createMockSocket>
    let callbacks: any

    beforeEach(() => {
      socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { previousSocketId: 'socket-old' } }
      })

      callbacks = {
        onRecoveryComplete: vi.fn(),
        onRecoveryFailed: vi.fn(),
        createWebSocketSubscriber: vi.fn().mockReturnValue({
          id: 'websocket-socket-new'
        })
      }

      // Set up state for old socket
      stateManager.createConnection('socket-old', {
        conversationId: 'conv-1',
        agentName: 'test-agent',
        context: { socketId: 'socket-old', agentName: 'test-agent' }
      })
      stateManager.transitionTo('socket-old', 'disconnected')

      disconnectedStreams.set('socket-old', {
        abortController: new AbortController(),
        timeoutId: setTimeout(() => {}, 1000),
        conversationId: 'conv-1',
        lastDeliveredSequence: 10
      })
    })

    it('sends recovery_status with manual mode', async () => {
      eventChannel.getEventsSince.mockReturnValue([])

      await manager.handleManualRecovery(socket, 'socket-old', callbacks)

      expect(socket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'recovery_status',
        data: expect.objectContaining({
          recoveryMode: 'manual'
        })
      }))
    })

    it('migrates socket ID after ACK', async () => {
      eventChannel.getEventsSince.mockReturnValue([])

      await manager.handleManualRecovery(socket, 'socket-old', callbacks)

      // Simulate client ACK
      socket.trigger('recovery_ack', {
        conversationId: 'conv-1',
        lastSequence: 10
      })

      // State should be accessible via new socket ID
      expect(stateManager.getStateData('socket-new')).toBeDefined()
      expect(stateManager.getStateData('socket-new')?.conversationId).toBe('conv-1')
    })

    it('removes old socket from disconnectedStreams', async () => {
      eventChannel.getEventsSince.mockReturnValue([])

      await manager.handleManualRecovery(socket, 'socket-old', callbacks)

      // Simulate client ACK
      socket.trigger('recovery_ack', {
        conversationId: 'conv-1',
        lastSequence: 10
      })

      expect(disconnectedStreams.has('socket-old')).toBe(false)
    })
  })

  describe('handleConversationRecovery', () => {
    let socket: ReturnType<typeof createMockSocket>
    let callbacks: any
    let validateAppId: ReturnType<typeof vi.fn>

    beforeEach(() => {
      socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { conversationId: 'conv-1' } }
      })

      callbacks = {
        onRecoveryComplete: vi.fn(),
        onRecoveryFailed: vi.fn(),
        createWebSocketSubscriber: vi.fn().mockReturnValue({
          id: 'websocket-socket-new'
        })
      }

      validateAppId = vi.fn().mockReturnValue(true)

      // Set up state for old socket
      stateManager.createConnection('socket-old', {
        conversationId: 'conv-1',
        agentName: 'test-agent',
        context: { socketId: 'socket-old', agentName: 'test-agent' }
      })
      stateManager.transitionTo('socket-old', 'disconnected')

      disconnectedStreams.set('socket-old', {
        abortController: new AbortController(),
        timeoutId: setTimeout(() => {}, 1000),
        conversationId: 'conv-1',
        lastDeliveredSequence: 15
      })
    })

    it('sends recovery_status with conversation mode', async () => {
      eventChannel.getEventsSince.mockReturnValue([])

      await manager.handleConversationRecovery(socket, 'conv-1', validateAppId, callbacks)

      expect(socket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'recovery_status',
        data: expect.objectContaining({
          recoveryMode: 'conversation'
        })
      }))
    })

    it('rejects recovery when app ID validation fails', async () => {
      validateAppId.mockReturnValue(false)

      await manager.handleConversationRecovery(socket, 'conv-1', validateAppId, callbacks)

      // Should send stream completed status instead of recovery
      expect(socket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'recovery_status',
        data: expect.objectContaining({
          streamCompleted: true
        })
      }))
    })

    it('sends stream completed when no stream found', async () => {
      await manager.handleConversationRecovery(socket, 'conv-nonexistent', validateAppId, callbacks)

      expect(socket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'recovery_status',
        data: expect.objectContaining({
          streamCompleted: true
        })
      }))
    })
  })

  describe('beginCatchUpHandshake', () => {
    let socket: ReturnType<typeof createMockSocket>

    beforeEach(() => {
      socket = createMockSocket({ id: 'socket-1' })
    })

    it('sends catchup_status with event count', () => {
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 20,
          type: 'chunk',
          content: 'catch-up',
          data: {},
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]

      manager.beginCatchUpHandshake(socket, {
        conversationId: 'conv-1',
        events,
        onComplete: vi.fn(),
        onTimeout: vi.fn()
      })

      expect(socket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'catchup_status',
        data: expect.objectContaining({
          pendingCount: 1,
          lastSequence: 20
        })
      }))
    })

    it('replays catch-up events', () => {
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 20,
          type: 'chunk',
          content: 'catch-up content',
          data: { delta: 'test' },
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]

      manager.beginCatchUpHandshake(socket, {
        conversationId: 'conv-1',
        events,
        onComplete: vi.fn(),
        onTimeout: vi.fn()
      })

      expect(socket.emit).toHaveBeenCalledWith('message', {
        type: 'chunk',
        content: 'catch-up content',
        data: { delta: 'test' }
      })
    })

    it('sends catchup_complete after events', () => {
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 20,
          type: 'chunk',
          content: 'test',
          data: {},
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]

      manager.beginCatchUpHandshake(socket, {
        conversationId: 'conv-1',
        events,
        onComplete: vi.fn(),
        onTimeout: vi.fn()
      })

      expect(socket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'catchup_complete',
        data: expect.objectContaining({
          eventsReplayed: 1,
          lastSequence: 20
        })
      }))
    })

    it('calls onComplete after catchup_ack', () => {
      const onComplete = vi.fn()
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 20,
          type: 'chunk',
          content: 'test',
          data: {},
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]

      manager.beginCatchUpHandshake(socket, {
        conversationId: 'conv-1',
        events,
        onComplete,
        onTimeout: vi.fn()
      })

      socket.trigger('catchup_ack', {
        conversationId: 'conv-1',
        lastSequence: 20
      })

      expect(onComplete).toHaveBeenCalledWith(20)
    })

    it('calls onTimeout after ACK timeout', () => {
      const onTimeout = vi.fn()
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 20,
          type: 'chunk',
          content: 'test',
          data: {},
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]

      manager.beginCatchUpHandshake(socket, {
        conversationId: 'conv-1',
        events,
        onComplete: vi.fn(),
        onTimeout
      })

      vi.advanceTimersByTime(config.ackTimeout + 1000)

      expect(onTimeout).toHaveBeenCalled()
    })

    it('calls onTimeout on disconnect', () => {
      const onTimeout = vi.fn()
      const events: StreamingEvent[] = [
        {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 20,
          type: 'chunk',
          content: 'test',
          data: {},
          timestamp: new Date(),
          agentName: 'test-agent'
        }
      ]

      manager.beginCatchUpHandshake(socket, {
        conversationId: 'conv-1',
        events,
        onComplete: vi.fn(),
        onTimeout
      })

      socket.trigger('disconnect')

      expect(onTimeout).toHaveBeenCalled()
    })
  })

  describe('getBufferLossInfo', () => {
    it('returns no loss when metadata is null', () => {
      eventChannel.getMetadata.mockReturnValue(null)

      const result = manager.getBufferLossInfo('conv-1', 10)

      expect(result).toEqual({ lossDetected: false, lostEventCount: 0 })
    })

    it('returns no loss when no events missing', () => {
      eventChannel.getMetadata.mockReturnValue({
        conversationId: 'conv-1',
        firstSequence: 10,
        lastSequence: 20,
        totalEvents: 11
      })

      const result = manager.getBufferLossInfo('conv-1', 10)

      expect(result).toEqual({ lossDetected: false, lostEventCount: 0 })
    })

    it('detects loss when events missing', () => {
      eventChannel.getMetadata.mockReturnValue({
        conversationId: 'conv-1',
        firstSequence: 15, // Buffer starts at 15
        lastSequence: 25,
        totalEvents: 11
      })

      // Client expects sequence 10, but buffer starts at 15
      const result = manager.getBufferLossInfo('conv-1', 10)

      expect(result).toEqual({ lossDetected: true, lostEventCount: 5 })
    })
  })

  describe('sendStreamCompletedStatus', () => {
    it('emits recovery_status with streamCompleted flag', () => {
      const socket = createMockSocket({ id: 'socket-1' })

      manager.sendStreamCompletedStatus(socket)

      expect(socket.emit).toHaveBeenCalledWith('message', {
        type: 'recovery_status',
        content: '',
        data: {
          isRecovering: true,
          hasBufferedEvents: false,
          bufferedEventCount: 0,
          streamCompleted: true
        }
      })
    })
  })

  describe('cleanupEventChannelSubscribers', () => {
    it('unsubscribes websocket subscriber with effective socket ID', () => {
      manager.cleanupEventChannelSubscribers('socket-1', 'conv-1')

      expect(eventChannel.unsubscribe).toHaveBeenCalledWith(
        'conv-1',
        'websocket-socket-1'
      )
    })

    it('unsubscribes persistence subscriber with original socket ID', () => {
      manager.cleanupEventChannelSubscribers('socket-1', 'conv-1')

      expect(eventChannel.unsubscribe).toHaveBeenCalledWith(
        'conv-1',
        'persistence-socket-1'
      )
    })

    it('unsubscribes APM subscriber when configured', () => {
      const managerWithApm = new ConnectionRecoveryManager(
        {
          stateManager,
          eventChannel: eventChannel as unknown as ConversationEventChannel,
          disconnectedStreams,
          logger: mockLogger
        },
        { ...config, apmAgent: {} }
      )

      managerWithApm.cleanupEventChannelSubscribers('socket-1', 'conv-1')

      expect(eventChannel.unsubscribe).toHaveBeenCalledWith(
        'conv-1',
        'apm-socket-1'
      )
    })

    it('follows socket ID migration chain for websocket subscriber', () => {
      // Set up migration
      stateManager.createConnection('socket-old', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-old', agentName: 'agent' }
      })
      stateManager.migrateSocketId('socket-old', 'socket-new')

      manager.cleanupEventChannelSubscribers('socket-old', 'conv-1')

      // WebSocket subscriber should use effective (new) socket ID
      expect(eventChannel.unsubscribe).toHaveBeenCalledWith(
        'conv-1',
        'websocket-socket-new'
      )
      // Persistence should use original socket ID
      expect(eventChannel.unsubscribe).toHaveBeenCalledWith(
        'conv-1',
        'persistence-socket-old'
      )
    })
  })
})
