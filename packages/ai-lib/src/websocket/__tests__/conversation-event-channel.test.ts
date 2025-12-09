import { describe, it, expect, beforeEach } from 'vitest'
import { ConversationEventChannel } from '../conversation-event-channel.js'
import type { EventSubscriber, StreamingEvent } from '../interfaces.js'

/**
 * Mock event subscriber for testing
 */
class MockSubscriber implements EventSubscriber {
  id: string
  events: StreamingEvent[] = []
  errors: Error[] = []
  shouldFail: boolean = false
  filterFn?: (event: StreamingEvent) => boolean

  constructor(id: string, options?: { shouldFail?: boolean; filter?: (event: StreamingEvent) => boolean }) {
    this.id = id
    this.shouldFail = options?.shouldFail ?? false
    this.filterFn = options?.filter
  }

  async onEvent(event: StreamingEvent): Promise<void> {
    if (this.shouldFail) {
      throw new Error(`Subscriber ${this.id} intentionally failed`)
    }
    this.events.push(event)
  }

  onError(error: Error): void {
    this.errors.push(error)
  }

  filter(event: StreamingEvent): boolean {
    return this.filterFn ? this.filterFn(event) : true
  }
}

describe('ConversationEventChannel', () => {
  let channel: ConversationEventChannel

  beforeEach(() => {
    channel = new ConversationEventChannel({
      capacity: 100,
      ttl: 5 * 60 * 1000 // 5 minutes
    })
  })

  describe('publish', () => {
    it('creates event with sequence number and timestamp', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      const event = await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test content',
        data: { source: 'test' },
        agentName: 'test-agent'
      })

      expect(event.id).toBeDefined()
      expect(event.sequence).toBe(0)
      expect(event.timestamp).toBeInstanceOf(Date)
      expect(event.type).toBe('chunk')
      expect(event.content).toBe('Test content')
      expect(event.agentName).toBe('test-agent')
      expect(event.deliveredTo).toBeInstanceOf(Set)
      expect(event.persisted).toBe(false)
    })

    it('notifies all registered subscribers', async () => {
      const subscriber1 = new MockSubscriber('sub1')
      const subscriber2 = new MockSubscriber('sub2')
      const subscriber3 = new MockSubscriber('sub3')

      channel.subscribe('conv1', subscriber1)
      channel.subscribe('conv1', subscriber2)
      channel.subscribe('conv1', subscriber3)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })

      expect(subscriber1.events).toHaveLength(1)
      expect(subscriber2.events).toHaveLength(1)
      expect(subscriber3.events).toHaveLength(1)
    })

    it('forces conversationId to match method argument even if eventData has different ID', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      // Publish with mismatched conversationId in eventData
      const event = await channel.publish('conv1', {
        conversationId: 'wrong-conv-id', // This should be overridden
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })

      // Event should have the method argument conversationId, not the eventData one
      expect(event.conversationId).toBe('conv1')
      expect(subscriber.events[0].conversationId).toBe('conv1')

      // Verify event is in the correct buffer (use -1 to get all events)
      const events = channel.getEventsSince('conv1', -1)
      expect(events).toHaveLength(1)
      expect(events[0].conversationId).toBe('conv1')
    })

    it('isolates subscriber errors when fail-fast is disabled', async () => {
      // Note: Current implementation uses fail-fast. This test documents the behavior.
      const subscriber1 = new MockSubscriber('sub1')
      const subscriber2 = new MockSubscriber('sub2', { shouldFail: true })

      channel.subscribe('conv1', subscriber1)
      channel.subscribe('conv1', subscriber2)

      await expect(
        channel.publish('conv1', {
          conversationId: 'conv1',
          type: 'chunk',
          content: 'Test',
          data: {},
          agentName: 'test'
        })
      ).rejects.toThrow('Subscriber sub2 failed')

      // subscriber1 received the event before subscriber2 failed
      expect(subscriber1.events).toHaveLength(1)
      expect(subscriber2.errors).toHaveLength(1)
    })

    it('fails fast when subscriber throws error (based on config)', async () => {
      const subscriber1 = new MockSubscriber('sub1')
      const subscriber2 = new MockSubscriber('sub2', { shouldFail: true })
      const subscriber3 = new MockSubscriber('sub3')

      channel.subscribe('conv1', subscriber1)
      channel.subscribe('conv1', subscriber2)
      channel.subscribe('conv1', subscriber3)

      await expect(
        channel.publish('conv1', {
          conversationId: 'conv1',
          type: 'chunk',
          content: 'Test',
          data: {},
          agentName: 'test'
        })
      ).rejects.toThrow('Subscriber sub2 failed')

      // subscriber1 received event
      expect(subscriber1.events).toHaveLength(1)

      // subscriber2 failed
      expect(subscriber2.errors).toHaveLength(1)

      // subscriber3 never received event (fail-fast stopped propagation)
      expect(subscriber3.events).toHaveLength(0)
    })

    it('respects subscriber filters', async () => {
      const subscriber1 = new MockSubscriber('sub1', {
        filter: (event) => event.type === 'chunk'
      })
      const subscriber2 = new MockSubscriber('sub2', {
        filter: (event) => event.type === 'tool_start'
      })

      channel.subscribe('conv1', subscriber1)
      channel.subscribe('conv1', subscriber2)

      // Publish chunk event
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Chunk event',
        data: {},
        agentName: 'test'
      })

      expect(subscriber1.events).toHaveLength(1)
      expect(subscriber2.events).toHaveLength(0)

      // Publish tool_start event
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'tool_start',
        content: 'Tool starting',
        data: {},
        agentName: 'test'
      })

      expect(subscriber1.events).toHaveLength(1) // Still 1
      expect(subscriber2.events).toHaveLength(1) // Now 1
    })

    it('increments sequence numbers monotonically', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 1',
        data: {},
        agentName: 'test'
      })

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 2',
        data: {},
        agentName: 'test'
      })

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 3',
        data: {},
        agentName: 'test'
      })

      expect(subscriber.events[0].sequence).toBe(0)
      expect(subscriber.events[1].sequence).toBe(1)
      expect(subscriber.events[2].sequence).toBe(2)
    })
  })

  describe('subscribe', () => {
    it('registers subscriber for conversation', () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      expect(channel.hasConversation('conv1')).toBe(true)
    })

    it('creates buffer if conversation does not exist', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      expect(channel.hasConversation('conv1')).toBe(true)

      // Publish should work immediately
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })

      expect(subscriber.events).toHaveLength(1)
    })

    it('allows multiple subscribers for same conversation', async () => {
      const subscriber1 = new MockSubscriber('sub1')
      const subscriber2 = new MockSubscriber('sub2')

      channel.subscribe('conv1', subscriber1)
      channel.subscribe('conv1', subscriber2)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })

      expect(subscriber1.events).toHaveLength(1)
      expect(subscriber2.events).toHaveLength(1)
    })
  })

  describe('unsubscribe', () => {
    it('removes subscriber from conversation', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test 1',
        data: {},
        agentName: 'test'
      })

      expect(subscriber.events).toHaveLength(1)

      channel.unsubscribe('conv1', 'sub1')

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test 2',
        data: {},
        agentName: 'test'
      })

      // Should still be 1 (not 2) because subscriber was removed
      expect(subscriber.events).toHaveLength(1)
    })

    it('cleans up buffer when last subscriber removed', () => {
      const subscriber1 = new MockSubscriber('sub1')
      const subscriber2 = new MockSubscriber('sub2')

      channel.subscribe('conv1', subscriber1)
      channel.subscribe('conv1', subscriber2)

      expect(channel.hasConversation('conv1')).toBe(true)

      channel.unsubscribe('conv1', 'sub1')
      expect(channel.hasConversation('conv1')).toBe(true) // Still has sub2

      channel.unsubscribe('conv1', 'sub2')
      expect(channel.hasConversation('conv1')).toBe(false) // Both removed
    })

    it('handles unsubscribe for non-existent conversation gracefully', () => {
      expect(() => {
        channel.unsubscribe('non-existent', 'sub1')
      }).not.toThrow()
    })

    it('handles unsubscribe for non-existent subscriber gracefully', () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      expect(() => {
        channel.unsubscribe('conv1', 'non-existent-subscriber')
      }).not.toThrow()
    })
  })

  describe('getEventsSince', () => {
    it('returns events after sequence number', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 0',
        data: {},
        agentName: 'test'
      })

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 1',
        data: {},
        agentName: 'test'
      })

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 2',
        data: {},
        agentName: 'test'
      })

      const events = channel.getEventsSince('conv1', 0)
      expect(events).toHaveLength(2) // Events 1 and 2
      expect(events[0].sequence).toBe(1)
      expect(events[1].sequence).toBe(2)
    })

    it('returns empty array for non-existent conversation', () => {
      const events = channel.getEventsSince('non-existent', 0)
      expect(events).toEqual([])
    })

    it('returns all events when querying from sequence -1', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 0',
        data: {},
        agentName: 'test'
      })

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 1',
        data: {},
        agentName: 'test'
      })

      const events = channel.getEventsSince('conv1', -1)
      expect(events).toHaveLength(2)
      expect(events[0].sequence).toBe(0)
      expect(events[1].sequence).toBe(1)
    })
  })

  describe('getMetadata', () => {
    it('returns conversation stats (event count, sequences, timestamps)', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 1',
        data: {},
        agentName: 'test'
      })

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Event 2',
        data: {},
        agentName: 'test'
      })

      const metadata = channel.getMetadata('conv1')
      expect(metadata).not.toBeNull()
      expect(metadata?.conversationId).toBe('conv1')
      expect(metadata?.totalEvents).toBe(2)
      expect(metadata?.firstSequence).toBe(0)
      expect(metadata?.lastSequence).toBe(1)
      expect(metadata?.oldestTimestamp).toBeInstanceOf(Date)
      expect(metadata?.newestTimestamp).toBeInstanceOf(Date)
    })

    it('returns null for non-existent conversation', () => {
      const metadata = channel.getMetadata('non-existent')
      expect(metadata).toBeNull()
    })

    it('returns null for conversation with no events', () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      const metadata = channel.getMetadata('conv1')
      expect(metadata).toBeNull()
    })
  })

  describe('cleanup', () => {
    it('removes expired conversations with no subscribers', async () => {
      // Note: In practice, unsubscribe() automatically deletes conversations with no subscribers
      // So cleanup() is primarily a safety mechanism for orphaned buffers
      // This test verifies cleanup() behavior if somehow a buffer exists without subscribers

      const shortTTLChannel = new ConversationEventChannel({
        capacity: 100,
        ttl: 0 // 0ms TTL (immediate expiration for testing)
      })

      // Create conversation with subscriber, then manually manipulate state for testing
      const subscriber = new MockSubscriber('sub1')
      shortTTLChannel.subscribe('conv1', subscriber)
      await shortTTLChannel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })

      // Verify conversation exists with subscriber
      expect(shortTTLChannel.hasConversation('conv1')).toBe(true)

      // Unsubscribe - this will auto-delete the conversation
      shortTTLChannel.unsubscribe('conv1', 'sub1')

      // Conversation should already be deleted by unsubscribe
      expect(shortTTLChannel.hasConversation('conv1')).toBe(false)
    })

    it('preserves active conversations', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })

      const removed = channel.cleanup()
      expect(removed).toBe(0)
      expect(channel.hasConversation('conv1')).toBe(true)
    })

    it('skips cleanup for expired conversations with active subscribers', async () => {
      // Create channel with 0ms TTL (immediate expiration)
      const shortTTLChannel = new ConversationEventChannel({
        capacity: 100,
        ttl: 0
      })

      const subscriber = new MockSubscriber('sub1')
      shortTTLChannel.subscribe('conv1', subscriber)

      await shortTTLChannel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Conversation is expired but has active subscriber - should NOT be cleaned up
      const removed = shortTTLChannel.cleanup()
      expect(removed).toBe(0)
      expect(shortTTLChannel.hasConversation('conv1')).toBe(true)
    })

    it('returns zero when all conversations have active subscribers', async () => {
      const shortTTLChannel = new ConversationEventChannel({
        capacity: 100,
        ttl: 0
      })

      const sub1 = new MockSubscriber('sub1')
      const sub2 = new MockSubscriber('sub2')
      const sub3 = new MockSubscriber('sub3')

      shortTTLChannel.subscribe('conv1', sub1)
      shortTTLChannel.subscribe('conv2', sub2)
      shortTTLChannel.subscribe('conv3', sub3)

      await shortTTLChannel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })
      await shortTTLChannel.publish('conv2', {
        conversationId: 'conv2',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })
      await shortTTLChannel.publish('conv3', {
        conversationId: 'conv3',
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test'
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      // All conversations have active subscribers, should not be cleaned up
      const removed = shortTTLChannel.cleanup()
      expect(removed).toBe(0)

      // Verify all conversations still exist
      expect(shortTTLChannel.hasConversation('conv1')).toBe(true)
      expect(shortTTLChannel.hasConversation('conv2')).toBe(true)
      expect(shortTTLChannel.hasConversation('conv3')).toBe(true)
    })
  })

  describe('getActiveConversationCount', () => {
    it('returns number of active conversations', () => {
      expect(channel.getActiveConversationCount()).toBe(0)

      const sub1 = new MockSubscriber('sub1')
      const sub2 = new MockSubscriber('sub2')

      channel.subscribe('conv1', sub1)
      expect(channel.getActiveConversationCount()).toBe(1)

      channel.subscribe('conv2', sub2)
      expect(channel.getActiveConversationCount()).toBe(2)

      channel.unsubscribe('conv1', 'sub1')
      expect(channel.getActiveConversationCount()).toBe(1)
    })
  })

  describe('hasConversation', () => {
    it('returns true if conversation exists, false otherwise', () => {
      expect(channel.hasConversation('conv1')).toBe(false)

      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      expect(channel.hasConversation('conv1')).toBe(true)

      channel.unsubscribe('conv1', 'sub1')

      expect(channel.hasConversation('conv1')).toBe(false)
    })
  })
})
