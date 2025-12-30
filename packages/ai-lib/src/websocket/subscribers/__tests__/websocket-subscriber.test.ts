import { describe, it, expect, beforeEach } from 'vitest'
import { WebSocketSubscriber, type IsDisconnectedFn } from '../websocket-subscriber.js'
import type { StreamingEvent } from '../../interfaces.js'

/**
 * Mock Socket.IO socket for testing
 */
class MockSocket {
  id: string
  connected: boolean = true
  emittedEvents: Array<{ event: string; data: any }> = []

  constructor(id: string) {
    this.id = id
  }

  emit(event: string, data: any): void {
    this.emittedEvents.push({ event, data })
  }

  disconnect(): void {
    this.connected = false
  }

  reconnect(): void {
    this.connected = true
  }
}

/**
 * Helper to create test streaming event
 */
function createTestEvent(overrides?: Partial<StreamingEvent>): StreamingEvent {
  return {
    id: 'test-event-id',
    conversationId: 'conv1',
    sequence: 0,
    type: 'chunk',
    content: 'Test content',
    data: { source: 'test' },
    timestamp: new Date(),
    agentName: 'test-agent',
    ...overrides
  }
}

describe('WebSocketSubscriber', () => {
  let socket: MockSocket
  let isDisconnected: IsDisconnectedFn
  let disconnectedSocketIds: Set<string>
  let subscriber: WebSocketSubscriber

  beforeEach(() => {
    socket = new MockSocket('socket-123')
    disconnectedSocketIds = new Set<string>()
    isDisconnected = (socketId: string) => disconnectedSocketIds.has(socketId)
    subscriber = new WebSocketSubscriber(socket, isDisconnected)
  })

  describe('constructor', () => {
    it('initializes with socket and isDisconnected function', () => {
      expect(subscriber.id).toBe('websocket-socket-123')
      expect(subscriber).toBeInstanceOf(WebSocketSubscriber)
    })
  })

  describe('onEvent', () => {
    it('emits to connected socket', async () => {
      const event = createTestEvent({
        type: 'chunk',
        content: 'Hello world',
        data: { step: 1 }
      })

      await subscriber.onEvent(event)

      expect(socket.emittedEvents).toHaveLength(1)
      expect(socket.emittedEvents[0].event).toBe('message')
      expect(socket.emittedEvents[0].data).toEqual({
        type: 'chunk',
        content: 'Hello world',
        data: { step: 1 }
      })
    })

    it('skips event when socket is disconnected (event channel handles buffering)', async () => {
      const event = createTestEvent({
        content: 'Content during disconnection'
      })

      // Mark socket as disconnected
      disconnectedSocketIds.add('socket-123')

      await subscriber.onEvent(event)

      // Should not emit to socket (disconnected)
      expect(socket.emittedEvents).toHaveLength(0)

      // No local buffering - event channel handles that
      // The event is simply skipped by the subscriber
    })

    it('converts StreamingEvent to WebSocketMessage format', async () => {
      const event = createTestEvent({
        id: 'event-123',
        sequence: 42,
        type: 'tool_start',
        content: 'Using tool',
        data: { toolName: 'fileEdit', toolId: 'tool-1' },
        timestamp: new Date('2025-01-01'),
        agentName: 'develop'
      })

      await subscriber.onEvent(event)

      expect(socket.emittedEvents[0].data).toEqual({
        type: 'tool_start',
        content: 'Using tool',
        data: { toolName: 'fileEdit', toolId: 'tool-1' }
      })

      // Verify StreamingEvent-specific fields are not included
      expect(socket.emittedEvents[0].data.id).toBeUndefined()
      expect(socket.emittedEvents[0].data.sequence).toBeUndefined()
      expect(socket.emittedEvents[0].data.timestamp).toBeUndefined()
      expect(socket.emittedEvents[0].data.agentName).toBeUndefined()
    })

    it('preserves event content and data', async () => {
      const event = createTestEvent({
        type: 'tool_result',
        content: 'Tool completed successfully',
        data: {
          toolId: 'tool-1',
          toolName: 'fileEdit',
          output: 'File edited',
          success: true
        }
      })

      await subscriber.onEvent(event)

      const emitted = socket.emittedEvents[0].data
      expect(emitted.content).toBe('Tool completed successfully')
      expect(emitted.data.toolId).toBe('tool-1')
      expect(emitted.data.toolName).toBe('fileEdit')
      expect(emitted.data.output).toBe('File edited')
      expect(emitted.data.success).toBe(true)
    })

    it('handles disconnected socket without recovery window gracefully', async () => {
      socket.disconnect()
      const event = createTestEvent()

      // Should not throw
      await expect(subscriber.onEvent(event)).resolves.toBeUndefined()

      // Should not emit (socket disconnected but not in disconnectedSocketIds means socket is truly gone)
      // The isDisconnected check happens first, but socket.connected check in emit would also catch this
      expect(socket.emittedEvents).toHaveLength(0)
    })
  })

  describe('onError', () => {
    it('emits error event to socket', () => {
      const error = new Error('Test error message')

      subscriber.onError(error)

      expect(socket.emittedEvents).toHaveLength(1)
      expect(socket.emittedEvents[0].event).toBe('message')
      expect(socket.emittedEvents[0].data.type).toBe('error')
      expect(socket.emittedEvents[0].data.content).toBe('Test error message')
      expect(socket.emittedEvents[0].data.data.error).toBe('Test error message')
      expect(socket.emittedEvents[0].data.data.timestamp).toBeDefined()
    })

    it('does not emit when socket is disconnected', () => {
      socket.disconnect()
      const error = new Error('Test error')

      subscriber.onError(error)

      // Should not emit to disconnected socket
      expect(socket.emittedEvents).toHaveLength(0)
    })
  })

  describe('filter', () => {
    it('returns true (no filtering by default)', () => {
      const event = createTestEvent({ type: 'chunk' })
      expect(subscriber.filter(event)).toBe(true)

      const toolEvent = createTestEvent({ type: 'tool_start' })
      expect(subscriber.filter(toolEvent)).toBe(true)

      const errorEvent = createTestEvent({ type: 'error' })
      expect(subscriber.filter(errorEvent)).toBe(true)
    })
  })

  describe('toWebSocketMessage', () => {
    it('correctly transforms event schema', () => {
      const event = createTestEvent({
        id: 'evt-123',
        conversationId: 'conv-456',
        sequence: 10,
        type: 'step_complete',
        content: 'Step completed',
        data: { step: 1, isFinal: false },
        timestamp: new Date('2025-01-01'),
        agentName: 'develop'
      })

      const message = subscriber.toWebSocketMessage(event)

      expect(message).toEqual({
        type: 'step_complete',
        content: 'Step completed',
        data: { step: 1, isFinal: false }
      })

      // Verify only type, content, and data are included
      expect(Object.keys(message)).toEqual(['type', 'content', 'data'])
    })

    it('handles all event types', () => {
      const eventTypes: Array<StreamingEvent['type']> = [
        'chunk',
        'tool_start',
        'tool_input_delta',
        'tool_call',
        'tool_result',
        'step_start',
        'step_complete',
        'complete',
        'error',
        'recovery_status'
      ]

      for (const type of eventTypes) {
        const event = createTestEvent({ type })
        const message = subscriber.toWebSocketMessage(event)
        expect(message.type).toBe(type)
      }
    })
  })

  describe('integration scenarios', () => {
    it('skips events during disconnection, resumes after reconnection', async () => {
      // Simulate disconnection (event channel handles buffering, not subscriber)
      disconnectedSocketIds.add('socket-123')

      // Send events while disconnected - they are SKIPPED (not buffered here)
      // The event channel buffers them separately
      await subscriber.onEvent(createTestEvent({ content: 'Event 1' }))
      await subscriber.onEvent(createTestEvent({ content: 'Event 2' }))
      await subscriber.onEvent(createTestEvent({ content: 'Event 3' }))

      // No emissions during disconnection
      expect(socket.emittedEvents).toHaveLength(0)

      // Simulate reconnection (remove from disconnectedSocketIds)
      // In reality, the server would replay events from event channel via getEventsSince()
      disconnectedSocketIds.delete('socket-123')

      // New events after reconnection should emit normally
      await subscriber.onEvent(createTestEvent({ content: 'Event 4' }))
      expect(socket.emittedEvents).toHaveLength(1)
      expect(socket.emittedEvents[0].data.content).toBe('Event 4')
    })

    it('uses function to check disconnected state', () => {
      // Verify the function-based approach works correctly
      expect(isDisconnected('socket-123')).toBe(false)

      disconnectedSocketIds.add('socket-123')
      expect(isDisconnected('socket-123')).toBe(true)

      disconnectedSocketIds.delete('socket-123')
      expect(isDisconnected('socket-123')).toBe(false)
    })
  })
})
