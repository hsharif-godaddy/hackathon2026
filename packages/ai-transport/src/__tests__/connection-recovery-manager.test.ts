import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConnectionRecoveryManager,
  type ConnectionRecoveryManagerConfig,
  type ConnectionRecoveryManagerDependencies
} from '../connection-recovery-manager.js'
import { ConnectionStateManager } from '../connection-state-manager.js'
import type { ConversationEventChannel } from '../conversation-event-channel.js'
import type { StreamingEvent } from '../interfaces.js'

// Mock Socket.IO socket
const createMockSocket = (overrides: Partial<{
  id: string
  handshake: { auth: Record<string, unknown> }
}> = {}) => {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {}
  const onceHandlers: Record<string, Array<(...args: any[]) => void>> = {}

  return {
    id: overrides.id ?? 'socket-123',
    handshake: overrides.handshake ?? { auth: {} },
    emit: vi.fn(),
    volatile: { emit: vi.fn() },
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
  let config: ConnectionRecoveryManagerConfig
  let mockLogger: any

  // Helper to create a disconnected connection in state manager
  const createDisconnectedConnection = (
    socketId: string,
    conversationId: string,
    lastDeliveredSequence: number = 10
  ) => {
    const abortController = new AbortController()
    stateManager.createConnection(socketId, {
      conversationId,
      agentName: 'test-agent',
      context: { appId: 'test-app' }
    })
    stateManager.updateConnection(socketId, {
      abortController,
      lastDeliveredSequence
    })
    // Transition to disconnected state
    stateManager.transitionTo(socketId, 'disconnected', {
      recoveryTimeoutId: setTimeout(() => {}, 1000) as NodeJS.Timeout
    })
    return abortController
  }

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

    config = {
      ackTimeout: 30_000,
      recoveryWindow: 5 * 60 * 1000
    }

    const dependencies: ConnectionRecoveryManagerDependencies = {
      stateManager,
      eventChannel: eventChannel as unknown as ConversationEventChannel,
      logger: mockLogger
    }

    manager = new ConnectionRecoveryManager(dependencies, config)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('attemptRecovery', () => {
    it('returns manual for socket with previousSocketId', async () => {
      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { previousSocketId: 'socket-old' } }
      })

      createDisconnectedConnection('socket-old', 'conv-1')

      const mode = await manager.attemptRecovery(socket)
      expect(mode).toBe('manual')
    })

    it('returns conversation for socket with conversationId cookie', async () => {
      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { conversationId: 'conv-1' } }
      })

      createDisconnectedConnection('socket-old', 'conv-1')

      const mode = await manager.attemptRecovery(socket)
      expect(mode).toBe('conversation')
    })

    it('returns null for fresh connection', async () => {
      const socket = createMockSocket({ id: 'socket-new' })

      const mode = await manager.attemptRecovery(socket)
      expect(mode).toBeNull()
    })

    it('returns null when previousSocketId not found', async () => {
      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { previousSocketId: 'socket-nonexistent' } }
      })

      const mode = await manager.attemptRecovery(socket)
      expect(mode).toBeNull()
    })
  })

  describe('duplication prevention (Fix: text stuttering bug)', () => {
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
        createWebSocketSubscriber: vi.fn().mockReturnValue({ id: 'websocket-socket-new' })
      }
      createDisconnectedConnection('socket-old', 'conv-1', 5)
    })

    describe('persisted event filtering', () => {
      it('filters persisted events for completed messages during manual recovery', async () => {
        const persistedEvent: StreamingEvent = {
          id: 'evt-persisted',
          conversationId: 'conv-1',
          sequence: 6,
          type: 'chunk',
          content: 'already in history',
          data: { messageId: 'msg-completed' },
          timestamp: new Date(),
          agentName: 'test-agent',
          persisted: true
        }
        const unpersisted: StreamingEvent = {
          id: 'evt-live',
          conversationId: 'conv-1',
          sequence: 7,
          type: 'chunk',
          content: 'not yet in history',
          data: { messageId: 'msg-completed' },
          timestamp: new Date(),
          agentName: 'test-agent',
          persisted: false
        }

        const managerWithHistory = new ConnectionRecoveryManager(
          {
            stateManager,
            eventChannel: eventChannel as unknown as ConversationEventChannel,
            logger: mockLogger,
            historyProvider: {
              loadHistory: vi.fn().mockResolvedValue({ messages: [{ id: 'msg-completed', content: 'hi', sender: 'assistant' }], hasMore: false, nextCursor: null, total: 1 })
            } as any
          },
          config
        )

        eventChannel.getEventsSince.mockReturnValue([persistedEvent, unpersisted])

        await managerWithHistory.handleManualRecovery(socket, 'socket-old', callbacks)

        // Manual recovery (page refresh): DB history provides the snapshot, persisted events
        // for completed messages are filtered out, only non-persisted events are replayed
        const allVolatileEmits = (socket.volatile.emit as any).mock.calls
        const replayedContents = allVolatileEmits
          .filter((call: any[]) => call[0] === 'message' && call[1]?.type === 'chunk')
          .map((call: any[]) => call[1].content)

        expect(replayedContents).not.toContain('already in history')
        expect(replayedContents).toContain('not yet in history')
      })

      it('filters persisted events but replays non-persisted events for in-progress messages', async () => {
        const persistedEvent: StreamingEvent = {
          id: 'evt-persisted-active',
          conversationId: 'conv-1',
          sequence: 6,
          type: 'chunk',
          content: 'already in snapshot',
          data: { messageId: 'msg-active' },
          timestamp: new Date(),
          agentName: 'test-agent',
          persisted: true
        }
        const nonPersistedEvent: StreamingEvent = {
          id: 'evt-live-active',
          conversationId: 'conv-1',
          sequence: 7,
          type: 'chunk',
          content: 'buffered after snapshot',
          data: { messageId: 'msg-active' },
          timestamp: new Date(),
          agentName: 'test-agent',
          persisted: false
        }

        // msg-active is in pendingMessageIds → in-progress
        eventChannel.getMetadata.mockReturnValue({ pendingMessageIds: ['msg-active'] })

        const managerWithHistory = new ConnectionRecoveryManager(
          {
            stateManager,
            eventChannel: eventChannel as unknown as ConversationEventChannel,
            logger: mockLogger,
            historyProvider: {
              loadHistory: vi.fn().mockResolvedValue({ messages: [{ id: 'msg-active', content: 'snapshot content', sender: 'assistant' }], hasMore: false, nextCursor: null, total: 1 })
            } as any
          },
          config
        )

        eventChannel.getEventsSince.mockReturnValue([persistedEvent, nonPersistedEvent])

        await managerWithHistory.handleManualRecovery(socket, 'socket-old', callbacks)

        const allVolatileEmits = (socket.volatile.emit as any).mock.calls
        const replayedContents = allVolatileEmits
          .filter((call: any[]) => call[0] === 'message' && call[1]?.type === 'chunk')
          .map((call: any[]) => call[1].content)

        // Persisted event should NOT be replayed (content already in DB snapshot)
        expect(replayedContents).not.toContain('already in snapshot')
        // Non-persisted event SHOULD be replayed (buffered since last DB write)
        expect(replayedContents).toContain('buffered after snapshot')
      })

      it('filters persisted events for completed messages, reports correct bufferedEventCount', async () => {
        const persistedEvent: StreamingEvent = {
          id: 'evt-p1',
          conversationId: 'conv-1',
          sequence: 6,
          type: 'chunk',
          content: 'persisted chunk',
          data: { messageId: 'msg-done' },
          timestamp: new Date(),
          agentName: 'test-agent',
          persisted: true
        }
        const liveEvent: StreamingEvent = {
          id: 'evt-l1',
          conversationId: 'conv-1',
          sequence: 7,
          type: 'chunk',
          content: 'live chunk',
          data: { messageId: 'msg-done' },
          timestamp: new Date(),
          agentName: 'test-agent',
          persisted: false
        }

        const managerWithHistory = new ConnectionRecoveryManager(
          {
            stateManager,
            eventChannel: eventChannel as unknown as ConversationEventChannel,
            logger: mockLogger,
            historyProvider: {
              loadHistory: vi.fn().mockResolvedValue({ messages: [{ id: 'msg-done', content: 'done', sender: 'assistant' }], hasMore: false, nextCursor: null, total: 1 })
            } as any
          },
          config
        )

        eventChannel.getEventsSince.mockReturnValue([persistedEvent, liveEvent])

        await managerWithHistory.handleManualRecovery(socket, 'socket-old', callbacks)

        // Only the non-persisted event for a completed message should be replayed
        const recoveryStatusCall = (socket.emit as any).mock.calls.find(
          (call: any[]) => call[1]?.type === 'recovery_status' && call[1]?.data?.isRecovering === true
        )
        expect(recoveryStatusCall).toBeDefined()
        expect(recoveryStatusCall[1].data.bufferedEventCount).toBe(1)
        expect(recoveryStatusCall[1].data.hasBufferedEvents).toBe(true)
      })

      it('replay_complete eventsReplayed matches filtered count', async () => {
        const events: StreamingEvent[] = [
          {
            id: 'evt-p',
            conversationId: 'conv-1',
            sequence: 6,
            type: 'chunk',
            content: 'persisted',
            data: { messageId: 'msg-done' },
            timestamp: new Date(),
            agentName: 'test-agent',
            persisted: true
          },
          {
            id: 'evt-l',
            conversationId: 'conv-1',
            sequence: 7,
            type: 'chunk',
            content: 'live',
            data: { messageId: 'msg-done' },
            timestamp: new Date(),
            agentName: 'test-agent',
            persisted: false
          }
        ]

        const managerWithHistory = new ConnectionRecoveryManager(
          {
            stateManager,
            eventChannel: eventChannel as unknown as ConversationEventChannel,
            logger: mockLogger,
            historyProvider: {
              loadHistory: vi.fn().mockResolvedValue({ messages: [{ id: 'msg-done', content: 'done', sender: 'assistant' }], hasMore: false, nextCursor: null, total: 1 })
            } as any
          },
          config
        )

        eventChannel.getEventsSince.mockReturnValue(events)

        await managerWithHistory.handleManualRecovery(socket, 'socket-old', callbacks)

        const replayCompleteCall = (socket.emit as any).mock.calls.find(
          (call: any[]) => call[1]?.type === 'replay_complete'
        )
        expect(replayCompleteCall).toBeDefined()
        // Only 1 non-persisted event replayed (persisted event filtered for completed message)
        expect(replayCompleteCall[1].data.eventsReplayed).toBe(1)
      })

      it('replays all events when no history provider is configured', async () => {
        const events: StreamingEvent[] = [
          {
            id: 'evt-p',
            conversationId: 'conv-1',
            sequence: 6,
            type: 'chunk',
            content: 'persisted chunk',
            data: {},
            timestamp: new Date(),
            agentName: 'test-agent',
            persisted: true
          },
          {
            id: 'evt-l',
            conversationId: 'conv-1',
            sequence: 7,
            type: 'chunk',
            content: 'live chunk',
            data: {},
            timestamp: new Date(),
            agentName: 'test-agent',
            persisted: false
          }
        ]
        eventChannel.getEventsSince.mockReturnValue(events)

        // manager from beforeEach has no historyProvider
        await manager.handleManualRecovery(socket, 'socket-old', callbacks)

        const replayedContents = (socket.volatile.emit as any).mock.calls
          .filter((call: any[]) => call[0] === 'message' && call[1]?.type === 'chunk')
          .map((call: any[]) => call[1].content)

        // Both events replayed because no history was loaded
        // Consecutive same-type chunks are coalesced into one event
        expect(replayedContents).toHaveLength(1)
        expect(replayedContents[0]).toContain('persisted chunk')
        expect(replayedContents[0]).toContain('live chunk')
      })
    })

    describe('volatile.emit for replay (prevents Socket.IO adapter duplication)', () => {
      it('uses volatile.emit for recovery replay events', async () => {
        eventChannel.getEventsSince.mockReturnValue([
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
        ])

        await manager.handleManualRecovery(socket, 'socket-old', callbacks)

        expect(socket.volatile.emit).toHaveBeenCalled()
        // Regular emit must not carry chunk-type messages
        const regularChunkEmits = (socket.emit as any).mock.calls.filter(
          (call: any[]) => call[1]?.type === 'chunk'
        )
        expect(regularChunkEmits).toHaveLength(0)
      })

      it('uses regular emit for control messages (recovery_status, replay_complete)', async () => {
        eventChannel.getEventsSince.mockReturnValue([])

        await manager.handleManualRecovery(socket, 'socket-old', callbacks)

        const controlMessages = (socket.emit as any).mock.calls
          .filter((call: any[]) => call[0] === 'message')
          .map((call: any[]) => call[1]?.type)

        expect(controlMessages).toContain('recovery_status')
        expect(controlMessages).toContain('replay_complete')
      })
    })

    describe('sequence number in replayed event data', () => {
      it('injects sequence from event into data for client-side deduplication', async () => {
        eventChannel.getEventsSince.mockReturnValue([
          {
            id: 'evt-1',
            conversationId: 'conv-1',
            sequence: 42,
            type: 'chunk',
            content: 'test chunk',
            data: { step: 1 },
            timestamp: new Date(),
            agentName: 'test-agent'
          }
        ])

        await manager.handleManualRecovery(socket, 'socket-old', callbacks)

        expect(socket.volatile.emit).toHaveBeenCalledWith('message', {
          type: 'chunk',
          content: 'test chunk',
          data: { step: 1, sequence: 42 }
        })
      })

      it('does not mutate original event data when injecting sequence', async () => {
        const originalData = { step: 1 }
        const event: StreamingEvent = {
          id: 'evt-1',
          conversationId: 'conv-1',
          sequence: 10,
          type: 'chunk',
          content: 'test',
          data: originalData,
          timestamp: new Date(),
          agentName: 'test-agent'
        }
        eventChannel.getEventsSince.mockReturnValue([event])

        await manager.handleManualRecovery(socket, 'socket-old', callbacks)

        // Original event data must not be mutated
        expect(originalData).toEqual({ step: 1 })
        expect((originalData as any).sequence).toBeUndefined()
      })

      it('injects sequence for catch-up events too', () => {
        const catchUpSocket = createMockSocket({ id: 'socket-cu' })

        manager.beginCatchUpHandshake(catchUpSocket, {
          conversationId: 'conv-1',
          coalescedEvents: [
            {
              id: 'cu-1',
              conversationId: 'conv-1',
              sequence: 99,
              type: 'tool_result',
              content: 'tool done',
              data: { tool: 'bash' },
              timestamp: new Date(),
              agentName: 'test-agent'
            }
          ],
          lastSequence: 99,
          onComplete: vi.fn(),
          onTimeout: vi.fn()
        })

        expect(catchUpSocket.volatile.emit).toHaveBeenCalledWith('message', {
          type: 'tool_result',
          content: 'tool done',
          data: { tool: 'bash', sequence: 99 }
        })
      })
    })

    it('scales ACK timeout with replayed event count', async () => {
      // Alternate between chunk and tool_input_delta so coalescing keeps all
      // 200 events (alternating types prevent merging)
      const manyEvents = Array.from({ length: 200 }, (_, i) => ({
        id: `evt-${i}`,
        conversationId: 'conv-1',
        sequence: i + 1,
        type: i % 2 === 0 ? 'chunk' : 'tool_input_delta',
        content: `data-${i}`,
        data: {},
        timestamp: new Date(),
        agentName: 'test-agent'
      }))
      eventChannel.getEventsSince.mockReturnValue(manyEvents)

      await manager.handleManualRecovery(socket, 'socket-old', callbacks)

      // After coalescing, alternating types produce 200 events (each is a single run)
      // 200 events × 100ms = 20s extra, so adaptive timeout = 50s
      // Base timeout (30s) should NOT trigger failure when events extend the window
      vi.advanceTimersByTime(config.ackTimeout + 1000) // 31s — within adaptive window
      expect(callbacks.onRecoveryFailed).not.toHaveBeenCalled()

      // Advance past adaptive timeout (50s total)
      vi.advanceTimersByTime(200 * 100) // +20s = 51s total
      expect(callbacks.onRecoveryFailed).toHaveBeenCalledWith(
        'socket-new',
        'ack_timeout'
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
      createDisconnectedConnection('socket-old', 'conv-1', 10)
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

    it('transitions old socket to connected state after recovery', async () => {
      eventChannel.getEventsSince.mockReturnValue([])

      await manager.handleManualRecovery(socket, 'socket-old', callbacks)

      // Simulate client ACK
      socket.trigger('recovery_ack', {
        conversationId: 'conv-1',
        lastSequence: 10
      })

      // Old socket should be migrated and in connected state
      const stateData = stateManager.getStateData('socket-new')
      expect(stateData?.state).toBe('connected')
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

      // Set up disconnected state for old socket
      createDisconnectedConnection('socket-old', 'conv-1', 15)
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
        coalescedEvents: events,
        lastSequence: 20,
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

    it('replays catch-up events via volatile.emit (not regular emit)', () => {
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
        coalescedEvents: events,
        lastSequence: 20,
        onComplete: vi.fn(),
        onTimeout: vi.fn()
      })

      // Must use volatile.emit to prevent Socket.IO adapter from storing
      // replay packets (which would cause duplicates on future reconnections)
      expect(socket.volatile.emit).toHaveBeenCalledWith('message', {
        type: 'chunk',
        content: 'catch-up content',
        data: { delta: 'test', sequence: 20 }
      })
      // Must NOT use regular emit for chunk events
      const regularChunkEmit = (socket.emit as any).mock.calls.find(
        (call: any[]) => call[1]?.type === 'chunk'
      )
      expect(regularChunkEmit).toBeUndefined()
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
        coalescedEvents: events,
        lastSequence: 20,
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
        coalescedEvents: events,
        lastSequence: 20,
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
        coalescedEvents: events,
        lastSequence: 20,
        onComplete: vi.fn(),
        onTimeout
      })

      vi.advanceTimersByTime(config.ackTimeout + 1000)

      expect(onTimeout).toHaveBeenCalled()
    })

    it('scales catch-up ACK timeout with event count', () => {
      const onTimeout = vi.fn()
      // Alternate between chunk and tool_input_delta so coalescing keeps all
      // 300 events (alternating types prevent merging)
      const manyEvents: StreamingEvent[] = Array.from({ length: 300 }, (_, i) => ({
        id: `evt-${i}`,
        conversationId: 'conv-1',
        sequence: i + 1,
        type: i % 2 === 0 ? 'chunk' : 'tool_input_delta',
        content: `data-${i}`,
        data: {},
        timestamp: new Date(),
        agentName: 'test-agent'
      }))

      manager.beginCatchUpHandshake(socket, {
        conversationId: 'conv-1',
        coalescedEvents: manyEvents,
        lastSequence: 300,
        onComplete: vi.fn(),
        onTimeout
      })

      // Base timeout (30s) should NOT trigger — adaptive = 30s + 300*100ms = 60s
      vi.advanceTimersByTime(config.ackTimeout + 1000)
      expect(onTimeout).not.toHaveBeenCalled()

      // Advance past adaptive timeout
      vi.advanceTimersByTime(300 * 100)
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
        coalescedEvents: events,
        lastSequence: 20,
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
    it('emits recovery_status with streamCompleted flag and history_complete', async () => {
      const socket = createMockSocket({ id: 'socket-1' })

      await manager.sendStreamCompletedStatus(socket)

      // Should emit recovery_status first
      expect(socket.emit).toHaveBeenCalledWith('message', {
        type: 'recovery_status',
        content: '',
        data: {
          isRecovering: true,
          hasBufferedEvents: false,
          bufferedEventCount: 0,
          streamCompleted: true,
          conversationId: undefined,
          historyStreaming: false,
          historyMessageCount: 0
        }
      })

      // Should always emit history_complete (even when empty) for consistent client-side handling
      expect(socket.emit).toHaveBeenCalledWith('message', {
        type: 'history_complete',
        content: '',
        data: {
          messageCount: 0,
          hasMore: false,
          nextCursor: null,
          total: 0
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

  describe('attemptRecovery - cookie-less recovery', () => {
    it('should resolve latest conversationId when cookie missing but appId has history', async () => {
      const getLatestConversationForApp = vi.fn().mockResolvedValue('conv-latest')

      const managerWithLatest = new ConnectionRecoveryManager(
        {
          stateManager,
          eventChannel: eventChannel as unknown as ConversationEventChannel,
          logger: mockLogger,
          getLatestConversationForApp
        },
        config
      )

      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { appId: 'app-123' } }
      })

      const mode = await managerWithLatest.attemptRecovery(socket)

      expect(mode).toBe('initial')
      expect(getLatestConversationForApp).toHaveBeenCalledWith('app-123')
      expect(socket.handshake.auth.conversationId).toBe('conv-latest')
      expect(mockLogger.info).toHaveBeenCalledWith(
        'recovery.cookie_less.resolved',
        expect.objectContaining({
          socketId: 'socket-new',
          appId: 'app-123',
          conversationId: 'conv-latest'
        })
      )
    })

    it('should return null when no cookie and no app history', async () => {
      const getLatestConversationForApp = vi.fn().mockResolvedValue(null)

      const managerWithLatest = new ConnectionRecoveryManager(
        {
          stateManager,
          eventChannel: eventChannel as unknown as ConversationEventChannel,
          logger: mockLogger,
          getLatestConversationForApp
        },
        config
      )

      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { appId: 'app-456' } }
      })

      const mode = await managerWithLatest.attemptRecovery(socket)

      expect(mode).toBeNull()
      expect(getLatestConversationForApp).toHaveBeenCalledWith('app-456')
    })

    it('should not call getLatestConversationForApp when conversationId present', async () => {
      const getLatestConversationForApp = vi.fn()

      const managerWithLatest = new ConnectionRecoveryManager(
        {
          stateManager,
          eventChannel: eventChannel as unknown as ConversationEventChannel,
          logger: mockLogger,
          getLatestConversationForApp
        },
        config
      )

      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { appId: 'app-123', conversationId: 'conv-existing' } }
      })

      const mode = await managerWithLatest.attemptRecovery(socket)

      expect(mode).toBe('initial')
      expect(getLatestConversationForApp).not.toHaveBeenCalled()
    })

    it('should handle getLatestConversationForApp not configured', async () => {
      // Manager without getLatestConversationForApp
      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { appId: 'app-123' } }
      })

      const mode = await manager.attemptRecovery(socket)

      expect(mode).toBeNull()
    })

    it('should extract appId from JWT auth formats', async () => {
      const getLatestConversationForApp = vi.fn().mockResolvedValue('conv-latest')

      const managerWithLatest = new ConnectionRecoveryManager(
        {
          stateManager,
          eventChannel: eventChannel as unknown as ConversationEventChannel,
          logger: mockLogger,
          getLatestConversationForApp
        },
        config
      )

      // Test with agentContext.appId format
      const socket = createMockSocket({
        id: 'socket-new',
        handshake: { auth: { agentContext: { appId: 'app-from-context' } } }
      })

      const mode = await managerWithLatest.attemptRecovery(socket)

      expect(mode).toBe('initial')
      expect(getLatestConversationForApp).toHaveBeenCalledWith('app-from-context')
    })
  })
})
