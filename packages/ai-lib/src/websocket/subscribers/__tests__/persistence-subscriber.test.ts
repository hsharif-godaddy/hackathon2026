import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PersistenceSubscriber } from '../persistence-subscriber.js'
import type { ConversationPersistence, PersistenceStreamingEvent, ConversationContext, StreamingEvent } from '../../interfaces.js'

/**
 * Mock ConversationPersistence for testing
 */
class MockPersistence implements ConversationPersistence {
  capturedEvents: Array<{ conversationId: string; event: PersistenceStreamingEvent; context: ConversationContext }> = []
  shouldFail: boolean = false
  failureMessage: string = 'Persistence failed'

  async startConversation(message: string, context: ConversationContext): Promise<string> {
    return 'conv-123'
  }

  async completeConversation(conversationId: string, events: PersistenceStreamingEvent[], result: any, context: ConversationContext): Promise<void> {
    // No-op for testing
  }

  async handleConversationError(conversationId: string, error: Error, message: string, context: ConversationContext): Promise<void> {
    // No-op for testing
  }

  async captureStreamingEvent(conversationId: string, event: PersistenceStreamingEvent, context: ConversationContext): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage)
    }
    this.capturedEvents.push({ conversationId, event, context })
  }
}

/**
 * Helper to create test streaming event
 */
function createTestEvent(overrides?: Partial<StreamingEvent>): StreamingEvent {
  return {
    id: 'event-123',
    conversationId: 'conv1',
    sequence: 0,
    type: 'chunk',
    content: 'Test content',
    data: { source: 'test' },
    timestamp: new Date('2025-01-01'),
    agentName: 'test-agent',
    persisted: false,
    ...overrides
  }
}

describe('PersistenceSubscriber', () => {
  let persistence: MockPersistence
  let context: ConversationContext
  let subscriber: PersistenceSubscriber

  beforeEach(() => {
    persistence = new MockPersistence()
    context = {
      socketId: 'socket-123',
      agentName: 'develop',
      appId: 'app-456'
    }
    subscriber = new PersistenceSubscriber(persistence, context)
  })

  describe('constructor', () => {
    it('initializes with ConversationPersistence and context', () => {
      expect(subscriber.id).toBe('persistence-socket-123')
      expect(subscriber).toBeInstanceOf(PersistenceSubscriber)
    })
  })

  describe('onEvent', () => {
    it('calls captureStreamingEvent with correct parameters', async () => {
      const event = createTestEvent({
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test content',
        data: { step: 1 }
      })

      await subscriber.onEvent(event)

      expect(persistence.capturedEvents).toHaveLength(1)
      expect(persistence.capturedEvents[0].conversationId).toBe('conv1')
      expect(persistence.capturedEvents[0].event.type).toBe('chunk')
      expect(persistence.capturedEvents[0].event.content).toBe('Test content')
      expect(persistence.capturedEvents[0].context).toBe(context)
    })

    it('converts StreamingEvent to PersistenceStreamingEvent format', async () => {
      const event = createTestEvent({
        id: 'evt-123',
        conversationId: 'conv-789',
        sequence: 42,
        type: 'tool_result',
        content: 'Tool completed',
        data: { toolId: 'tool-1', output: 'result' },
        timestamp: new Date('2025-01-15'),
        agentName: 'develop',
        persisted: false
      })

      await subscriber.onEvent(event)

      const captured = persistence.capturedEvents[0].event
      expect(captured).toEqual({
        type: 'tool_result',
        content: 'Tool completed',
        data: { toolId: 'tool-1', output: 'result' },
        timestamp: new Date('2025-01-15')
      })

      // Verify StreamingEvent-specific fields are not included
      expect((captured as any).id).toBeUndefined()
      expect((captured as any).sequence).toBeUndefined()
      expect((captured as any).conversationId).toBeUndefined()
      expect((captured as any).agentName).toBeUndefined()
      expect((captured as any).persisted).toBeUndefined()
    })

    it('marks event as persisted on success', async () => {
      const event = createTestEvent({ persisted: false })

      expect(event.persisted).toBe(false)

      await subscriber.onEvent(event)

      expect(event.persisted).toBe(true)
    })

    it('throws error if persistence fails (for fail-fast)', async () => {
      persistence.shouldFail = true
      persistence.failureMessage = 'Database connection failed'

      const event = createTestEvent()

      await expect(subscriber.onEvent(event)).rejects.toThrow('Database connection failed')

      // Event should not be marked as persisted
      expect(event.persisted).toBe(false)
    })

    it('converts non-Error failures to Error instances', async () => {
      persistence.shouldFail = true
      // Simulate non-Error throw
      vi.spyOn(persistence, 'captureStreamingEvent').mockRejectedValue('String error')

      const event = createTestEvent()

      await expect(subscriber.onEvent(event)).rejects.toThrow('Persistence failed: String error')
    })
  })

  describe('onError', () => {
    it('logs error without throwing', () => {
      const error = new Error('Test error')

      // Should not throw
      expect(() => subscriber.onError(error)).not.toThrow()
    })
  })

  describe('toPersistenceEvent', () => {
    it('correctly transforms event schema', () => {
      const event = createTestEvent({
        id: 'evt-abc',
        conversationId: 'conv-xyz',
        sequence: 99,
        type: 'step_complete',
        content: 'Step finished',
        data: { step: 3, isFinal: true },
        timestamp: new Date('2025-02-01'),
        agentName: 'marketing',
        persisted: false
      })

      const persistenceEvent = subscriber.toPersistenceEvent(event)

      expect(persistenceEvent).toEqual({
        type: 'step_complete',
        content: 'Step finished',
        data: { step: 3, isFinal: true },
        timestamp: new Date('2025-02-01')
      })

      // Verify only required fields are included
      expect(Object.keys(persistenceEvent).sort()).toEqual(['content', 'data', 'timestamp', 'type'])
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
        const persistenceEvent = subscriber.toPersistenceEvent(event)
        expect(persistenceEvent.type).toBe(type)
      }
    })

    it('preserves undefined content', () => {
      const event = createTestEvent({ content: undefined as any })
      const persistenceEvent = subscriber.toPersistenceEvent(event)

      expect(persistenceEvent.content).toBeUndefined()
    })
  })

  describe('filter', () => {
    it('returns true (persists all events by default)', () => {
      const chunkEvent = createTestEvent({ type: 'chunk' })
      expect(subscriber.filter(chunkEvent)).toBe(true)

      const toolEvent = createTestEvent({ type: 'tool_start' })
      expect(subscriber.filter(toolEvent)).toBe(true)

      const errorEvent = createTestEvent({ type: 'error' })
      expect(subscriber.filter(errorEvent)).toBe(true)
    })
  })

  describe('integration scenarios', () => {
    it('handles multiple events in sequence', async () => {
      const events = [
        createTestEvent({ content: 'Event 1', sequence: 0 }),
        createTestEvent({ content: 'Event 2', sequence: 1 }),
        createTestEvent({ content: 'Event 3', sequence: 2 })
      ]

      for (const event of events) {
        await subscriber.onEvent(event)
      }

      expect(persistence.capturedEvents).toHaveLength(3)
      expect(persistence.capturedEvents[0].event.content).toBe('Event 1')
      expect(persistence.capturedEvents[1].event.content).toBe('Event 2')
      expect(persistence.capturedEvents[2].event.content).toBe('Event 3')

      // All marked as persisted
      for (const event of events) {
        expect(event.persisted).toBe(true)
      }
    })

    it('passes context through to persistence layer', async () => {
      const customContext: ConversationContext = {
        socketId: 'custom-socket',
        agentName: 'custom-agent',
        appId: 'custom-app',
        userId: 'user-123',
        sessionId: 'session-456',
        customField: 'custom-value'
      }

      const customSubscriber = new PersistenceSubscriber(persistence, customContext)
      const event = createTestEvent()

      await customSubscriber.onEvent(event)

      expect(persistence.capturedEvents[0].context).toEqual(customContext)
    })
  })
})
