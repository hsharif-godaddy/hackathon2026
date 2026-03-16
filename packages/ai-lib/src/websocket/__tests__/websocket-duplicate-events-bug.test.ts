import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Server as HTTPServer } from 'http'
import { WebSocketServer } from '../experimental-websocket-server.js'
import { createNoOpPersistence } from '../noop-persistence.js'
import type { ExperimentalAgentWrapper } from '../../core/agent-factory.js'

/**
 * Test to reproduce the duplicate events bug that occurs with multiple disconnect/reconnect cycles.
 *
 * Root cause: When we manually replay events via socket.emit() during recovery, Socket.IO's
 * adapter stores those packets in its recovery buffer. On subsequent reconnections, Socket.IO
 * replays these stale packets from previous manual replays, causing duplicates.
 *
 * This test simulates Socket.IO's actual behavior by tracking emitted packets and replaying
 * them on recovery (mimicking what Socket.IO's SessionAwareAdapter does).
 */

// Mock Socket.IO at module level
const mockIO = {
  on: vi.fn(),
  close: vi.fn()
}

vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(() => mockIO)
}))

// Mock agent
const mockAgent: ExperimentalAgentWrapper = {
  getName: () => 'test-agent',
  streamGenerate: vi.fn()
} as any

const mockAgents = {
  get: vi.fn().mockReturnValue(mockAgent),
  list: vi.fn().mockReturnValue(['test-agent'])
}

describe('WebSocket Duplicate Events Bug - Multiple Reconnection Cycles', () => {
  let httpServer: HTTPServer

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
  })

  it('should reproduce duplicate events after multiple disconnect/reconnect cycles', async () => {
    /**
     * Simulates Socket.IO's packet storage behavior (what SessionAwareAdapter.broadcast does)
     * In real Socket.IO, EVERY socket.emit() call stores the packet in the recovery buffer.
     */
    const socketIOPacketBuffer: Array<{ socketId: string; event: string; data: any }> = []

    // Track all events received by each socket to detect duplicates
    const socketAReceivedEvents: string[] = []

    // Create test server
    const testServer = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })

    const eventChannel = (testServer as any).eventChannel
    const stateManager = (testServer as any).stateManager

    // ========================================
    // CYCLE 1: Initial stream, disconnect, reconnect (socket-A)
    // ========================================

    // Step 1: Create initial socket-A with events
    const mockSocketA = {
      id: 'socket-A',
      emit: vi.fn((event: string, data: any) => {
        // Simulate Socket.IO adapter storing packets
        socketIOPacketBuffer.push({ socketId: 'socket-A', event, data })
        socketAReceivedEvents.push(`${data.type}:${data.content}`)
      }),
      on: vi.fn(),
      connected: true,
      handshake: { auth: {} }
    }

    // Step 2: Simulate events 1-3 being published BEFORE disconnect
    // These go through normal WebSocketSubscriber path
    const controller = new AbortController()
    stateManager.createConnection('socket-A', {
      conversationId: 'test-conv-id',
      agentName: 'test-agent',
      context: { socketId: 'socket-A' }
    })
    stateManager.updateConnection('socket-A', {
      abortController: controller,
      lastDeliveredSequence: -1
    })

    // Publish events 1-3 (normal operation, before disconnect)
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 1',
      data: {},
      agentName: 'test-agent'
    })
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 2',
      data: {},
      agentName: 'test-agent'
    })
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 3',
      data: {},
      agentName: 'test-agent'
    })

    // Manually emit these through WebSocketSubscriber (simulating normal operation)
    const { WebSocketSubscriber } = await import('../subscribers/websocket-subscriber.js')
    const isDisconnected = (socketId: string) => stateManager.isDisconnected(socketId)
    const subscriber = new WebSocketSubscriber(mockSocketA, isDisconnected)
    eventChannel.subscribe('test-conv-id', subscriber)

    // These would be emitted automatically, but we'll manually trigger for test clarity
    mockSocketA.emit('message', { type: 'chunk', content: 'Event 1', data: {} })
    mockSocketA.emit('message', { type: 'chunk', content: 'Event 2', data: {} })
    mockSocketA.emit('message', { type: 'chunk', content: 'Event 3', data: {} })

    // Step 3: Simulate disconnect while streaming is active
    stateManager.updateConnection('socket-A', {
      lastDeliveredSequence: 2  // Last delivered sequence (0-based) before disconnect
    })
    const recoveryTimeoutId1 = setTimeout(() => {}, 60000)
    stateManager.transitionTo('socket-A', 'disconnected', { recoveryTimeoutId: recoveryTimeoutId1 })

    // Step 4: Events 4-5 published DURING disconnect (go to event channel only, not Socket.IO)
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 4',
      data: {},
      agentName: 'test-agent'
    })
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 5',
      data: {},
      agentName: 'test-agent'
    })

    // Step 5: Simulate reconnect (socket-A reconnects)
    // Manual replay sends events 4-5 via socket.emit()
    mockSocketA.connected = true

    const missedEvents = eventChannel.getEventsSince('test-conv-id', 2)
    expect(missedEvents).toHaveLength(2)
    expect(missedEvents[0].content).toBe('Event 4')
    expect(missedEvents[1].content).toBe('Event 5')

    // Manual replay (this is what the server does on reconnection)
    // BUG: These socket.emit() calls get stored in Socket.IO's recovery buffer!
    for (const event of missedEvents) {
      mockSocketA.emit('message', {
        type: event.type,
        content: event.content,
        data: event.data
      })
    }

    // Clean up cycle 1 - transition back to connected
    clearTimeout(recoveryTimeoutId1)
    stateManager.transitionTo('socket-A', 'connected', {
      recoveryTimeoutId: undefined,
      lastDeliveredSequence: 4
    })

    // ========================================
    // CYCLE 2: Second disconnect/reconnect
    // ========================================

    // Step 6: Simulate another disconnect
    const recoveryTimeoutId2 = setTimeout(() => {}, 60000)
    stateManager.transitionTo('socket-A', 'disconnected', { recoveryTimeoutId: recoveryTimeoutId2 })

    // Step 7: Events 6-7 published during second disconnect
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 6',
      data: {},
      agentName: 'test-agent'
    })
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 7',
      data: {},
      agentName: 'test-agent'
    })

    // Step 8: Simulate second reconnect
    // Socket.IO would replay its buffer (which includes events 1-5)
    // Then manual replay would send events 6-7

    // Simulate Socket.IO automatic replay (replays ALL stored packets)
    // In real Socket.IO, this includes packets from manual replay in Cycle 1!
    const packetsForSocketA = socketIOPacketBuffer.filter(p => p.socketId === 'socket-A')
    for (const packet of packetsForSocketA) {
      // Socket.IO replays these automatically
      socketAReceivedEvents.push(`${packet.data.type}:${packet.data.content}`)
    }

    // Then our manual replay ALSO sends events
    const missedEvents2 = eventChannel.getEventsSince('test-conv-id', 4)
    expect(missedEvents2).toHaveLength(2)

    for (const event of missedEvents2) {
      mockSocketA.emit('message', {
        type: event.type,
        content: event.content,
        data: event.data
      })
    }

    // ========================================
    // VERIFY: Should see duplicates
    // ========================================

    console.log('\n=== Socket-A Received Events (Cycle 2) ===')
    console.log(socketAReceivedEvents)
    console.log('===========================================\n')

    // Count occurrences of each event
    const eventCounts = socketAReceivedEvents.reduce((acc, evt) => {
      acc[evt] = (acc[evt] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    console.log('Event counts:', eventCounts)

    // BUG REPRODUCTION: Events 4 and 5 appear TWICE
    // - Once from Socket.IO replay (stored when manually replayed in Cycle 1)
    // - Once from manual replay in Cycle 2
    //
    // This assertion SHOULD PASS, demonstrating the bug exists
    expect(eventCounts['chunk:Event 4']).toBeGreaterThan(1)
    expect(eventCounts['chunk:Event 5']).toBeGreaterThan(1)

    // Events 6-7 should appear exactly once (only from manual replay)
    expect(eventCounts['chunk:Event 6']).toBe(1)
    expect(eventCounts['chunk:Event 7']).toBe(1)

    // Clean up
    clearTimeout(recoveryTimeoutId2)
    testServer.close()
  })

  it('should NOT have duplicates when using volatile emits (the fix)', async () => {
    /**
     * This test demonstrates that using socket.volatile.emit() during manual replay
     * prevents Socket.IO from storing those packets, eliminating duplicates.
     */
    const socketIOPacketBuffer: Array<{ socketId: string; event: string; data: any; volatile: boolean }> = []
    const socketAReceivedEvents: string[] = []

    const testServer = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })

    const eventChannel = (testServer as any).eventChannel
    const stateManager = (testServer as any).stateManager

    // Socket with volatile emit support
    const mockSocketA = {
      id: 'socket-A',
      emit: vi.fn((event: string, data: any) => {
        // Normal emit - stored by Socket.IO
        socketIOPacketBuffer.push({ socketId: 'socket-A', event, data, volatile: false })
        socketAReceivedEvents.push(`${data.type}:${data.content}`)
      }),
      volatile: {
        emit: vi.fn((event: string, data: any) => {
          // Volatile emit - NOT stored by Socket.IO
          // Just send to client, don't add to buffer
          socketAReceivedEvents.push(`${data.type}:${data.content}`)
        })
      },
      on: vi.fn(),
      connected: true,
      handshake: { auth: {} }
    }

    // Setup initial state
    const controller = new AbortController()
    stateManager.createConnection('socket-A', {
      conversationId: 'test-conv-id',
      agentName: 'test-agent',
      context: { socketId: 'socket-A' }
    })
    stateManager.updateConnection('socket-A', {
      abortController: controller,
      lastDeliveredSequence: -1
    })

    // Events 1-3 (normal operation)
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 1',
      data: {},
      agentName: 'test-agent'
    })
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 2',
      data: {},
      agentName: 'test-agent'
    })
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 3',
      data: {},
      agentName: 'test-agent'
    })

    mockSocketA.emit('message', { type: 'chunk', content: 'Event 1', data: {} })
    mockSocketA.emit('message', { type: 'chunk', content: 'Event 2', data: {} })
    mockSocketA.emit('message', { type: 'chunk', content: 'Event 3', data: {} })

    // Disconnect
    stateManager.updateConnection('socket-A', { lastDeliveredSequence: 2 })
    const recoveryTimeoutId1 = setTimeout(() => {}, 60000)
    stateManager.transitionTo('socket-A', 'disconnected', { recoveryTimeoutId: recoveryTimeoutId1 })

    // Events 4-5 during disconnect
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 4',
      data: {},
      agentName: 'test-agent'
    })
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 5',
      data: {},
      agentName: 'test-agent'
    })

    // Reconnect - manual replay using VOLATILE emit (the fix)
    const missedEvents = eventChannel.getEventsSince('test-conv-id', 2)
    for (const event of missedEvents) {
      // FIX: Use volatile emit so Socket.IO doesn't store these
      mockSocketA.volatile.emit('message', {
        type: event.type,
        content: event.content,
        data: event.data
      })
    }

    // Transition back to connected
    clearTimeout(recoveryTimeoutId1)
    stateManager.transitionTo('socket-A', 'connected', {
      recoveryTimeoutId: undefined,
      lastDeliveredSequence: 4
    })

    // Second disconnect
    const recoveryTimeoutId2 = setTimeout(() => {}, 60000)
    stateManager.transitionTo('socket-A', 'disconnected', { recoveryTimeoutId: recoveryTimeoutId2 })

    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 6',
      data: {},
      agentName: 'test-agent'
    })
    await eventChannel.publish('test-conv-id', {
      type: 'chunk',
      content: 'Event 7',
      data: {},
      agentName: 'test-agent'
    })

    // Second reconnect

    // Socket.IO replay - only includes non-volatile packets (events 1-3)
    const nonVolatilePackets = socketIOPacketBuffer.filter(p => !p.volatile && p.socketId === 'socket-A')
    for (const packet of nonVolatilePackets) {
      socketAReceivedEvents.push(`${packet.data.type}:${packet.data.content}`)
    }

    // Manual replay using volatile
    const missedEvents2 = eventChannel.getEventsSince('test-conv-id', 4)
    for (const event of missedEvents2) {
      mockSocketA.volatile.emit('message', {
        type: event.type,
        content: event.content,
        data: event.data
      })
    }

    // Verify no duplicates (events 4-7 should only appear once across both cycles)
    const eventCounts = socketAReceivedEvents.reduce((acc, evt) => {
      acc[evt] = (acc[evt] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    console.log('\n=== With Volatile Fix - Event Counts ===')
    console.log(eventCounts)
    console.log('=========================================\n')

    expect(eventCounts['chunk:Event 4']).toBe(1)
    expect(eventCounts['chunk:Event 5']).toBe(1)
    expect(eventCounts['chunk:Event 6']).toBe(1)
    expect(eventCounts['chunk:Event 7']).toBe(1)

    // Clean up
    clearTimeout(recoveryTimeoutId2)
    testServer.close()
  })
})
