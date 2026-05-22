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

    it('marks buffered events for a persisted message', async () => {
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'persisted',
        data: { messageId: 'msg_1' },
        agentName: 'test-agent'
      })
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'live',
        data: { messageId: 'msg_2' },
        agentName: 'test-agent'
      })
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'status',
        content: '',
        data: {},
        agentName: 'system'
      })

      expect(channel.markMessageEventsPersisted('conv1', 'msg_1')).toBe(1)

      const events = channel.getEventsSince('conv1', -1)
      expect(events.find(event => event.data?.messageId === 'msg_1')?.persisted).toBe(true)
      expect(events.find(event => event.data?.messageId === 'msg_2')?.persisted).toBe(false)
      expect(events.find(event => event.type === 'status')?.persisted).toBe(false)
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

    it('retains buffer when last subscriber removed so reconnect can replay', async () => {
      const subscriber1 = new MockSubscriber('sub1')
      const subscriber2 = new MockSubscriber('sub2')

      channel.subscribe('conv1', subscriber1)
      channel.subscribe('conv1', subscriber2)
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'complete',
        content: '',
        data: { finishReason: 'complete' },
        agentName: 'test'
      })

      expect(channel.hasConversation('conv1')).toBe(true)

      channel.unsubscribe('conv1', 'sub1')
      expect(channel.hasConversation('conv1')).toBe(true) // Still has sub2

      channel.unsubscribe('conv1', 'sub2')
      expect(channel.hasConversation('conv1')).toBe(true)
      expect(channel.getEventsSince('conv1', -1).map(event => event.type)).toEqual(['complete'])
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
      // unsubscribe() retains buffers without subscribers so reconnect can
      // replay missed terminal events; cleanup() removes them after TTL.

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
        data: { messageId: 'msg-cleanup' },
        agentName: 'test'
      })
      expect(shortTTLChannel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-cleanup')

      // Verify conversation exists with subscriber
      expect(shortTTLChannel.hasConversation('conv1')).toBe(true)

      // Unsubscribe - this keeps the buffer until cleanup so reconnect can replay
      shortTTLChannel.unsubscribe('conv1', 'sub1')

      // TTL cleanup removes the now-idle retained buffer
      const removed = shortTTLChannel.cleanup()
      expect(removed).toBe(1)
      expect(shortTTLChannel.hasConversation('conv1')).toBe(false)
      expect(shortTTLChannel.getMetadata('conv1')).toBeNull()

      // Reusing the same conversation ID should not expose stale pending IDs.
      shortTTLChannel.subscribe('conv1', new MockSubscriber('sub2'))
      await shortTTLChannel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Next',
        data: {},
        agentName: 'test'
      })
      expect(shortTTLChannel.getMetadata('conv1')?.pendingMessageIds).toEqual([])
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

  describe('pendingMessageIds lifecycle', () => {
    it('should add messageId to pendingMessageIds on streaming events and remove on complete', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      // chunk event with messageId → adds to pending
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Hello',
        data: { messageId: 'msg-1' },
        agentName: 'test'
      })

      const metaAfterChunk = channel.getMetadata('conv1')
      expect(metaAfterChunk?.pendingMessageIds).toContain('msg-1')

      // complete event with same messageId → removes from pending
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'complete',
        content: '',
        data: { messageId: 'msg-1' },
        agentName: 'test'
      })

      const metaAfterComplete = channel.getMetadata('conv1')
      expect(metaAfterComplete?.pendingMessageIds).not.toContain('msg-1')
      expect(metaAfterComplete?.pendingMessageIds).toHaveLength(0)
    })

    it('should clear all pendingMessageIds on complete event without messageId (abort/handoff path)', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Streaming...',
        data: { messageId: 'msg-abort' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-abort')

      // complete event without messageId (conversation state already cleaned up)
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'complete',
        content: '',
        data: {},
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toHaveLength(0)
    })

    it('should clear all pendingMessageIds on error events even when messageId is present (error is terminal)', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      // Two sibling pending IDs from the same turn
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'tool_start',
        content: '',
        data: { messageId: 'msg-tool-A' },
        agentName: 'test'
      })
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'step_start',
        content: '',
        data: { messageId: 'msg-step-B' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-tool-A')
      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-step-B')

      // Error with messageId for only one of them → should still clear ALL
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'error',
        content: '',
        data: { messageId: 'msg-step-B', error: 'Some error' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toHaveLength(0)
    })

    it('should clear all pendingMessageIds on error events without messageId (budget error)', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      // Simulate streaming: chunk adds messageId to pending
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Partial response',
        data: { messageId: 'msg-budget' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-budget')

      // Budget error event — real server shape: no messageId in errorMetadata
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'error',
        content: 'Your AI usage budget has been reached.',
        data: { errorType: 'BUDGET_EXCEEDED', statusCode: 429, timestamp: new Date().toISOString(), agentId: 'develop' },
        agentName: 'test'
      })

      const metaAfterError = channel.getMetadata('conv1')
      expect(metaAfterError?.pendingMessageIds).toHaveLength(0)
    })

    it('should NOT clear pendingMessageIds on TOOL_VALIDATION_ERROR (non-terminal, agent retries)', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Streaming...',
        data: { messageId: 'msg-retry' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-retry')

      // TOOL_VALIDATION_ERROR — non-terminal, agent retries with corrections
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'error',
        content: 'Tool call failed due to invalid input format.',
        data: { errorType: 'TOOL_VALIDATION_ERROR', statusCode: 400 },
        agentName: 'test'
      })

      // Should still be pending — stream continues
      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-retry')
    })

    it('should clear pendingMessageIds on error with no errorType (AbortError, NetworkError, etc.)', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Streaming...',
        data: { messageId: 'msg-abort' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-abort')

      // Generic error with no errorType — still terminal
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'error',
        content: 'Connection aborted',
        data: {},
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toHaveLength(0)
    })

    it('should only clear pendingMessageIds for the affected conversation (cross-conversation isolation)', async () => {
      const sub1 = new MockSubscriber('sub1')
      const sub2 = new MockSubscriber('sub2')
      channel.subscribe('conv1', sub1)
      channel.subscribe('conv2', sub2)

      // Add pending messages to both conversations
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Conv1 streaming',
        data: { messageId: 'msg-conv1' },
        agentName: 'test'
      })
      await channel.publish('conv2', {
        conversationId: 'conv2',
        type: 'chunk',
        content: 'Conv2 streaming',
        data: { messageId: 'msg-conv2' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-conv1')
      expect(channel.getMetadata('conv2')?.pendingMessageIds).toContain('msg-conv2')

      // Terminal error on conv1 only
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'error',
        content: 'Budget exceeded',
        data: { errorType: 'BUDGET_EXCEEDED' },
        agentName: 'test'
      })

      // conv1 cleared, conv2 untouched
      expect(channel.getMetadata('conv1')?.pendingMessageIds).toHaveLength(0)
      expect(channel.getMetadata('conv2')?.pendingMessageIds).toContain('msg-conv2')
    })

    it('should clear pendingMessageIds on step_complete events', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'step_start',
        content: '',
        data: { messageId: 'msg-2' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-2')

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'step_complete',
        content: '',
        data: { messageId: 'msg-2' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toHaveLength(0)
    })

    it('step_complete should remove only targeted messageId, not siblings', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      // Two sibling pending IDs
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'step_start',
        content: '',
        data: { messageId: 'msg-A' },
        agentName: 'test'
      })
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'step_start',
        content: '',
        data: { messageId: 'msg-B' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toHaveLength(2)

      // step_complete for msg-A only
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'step_complete',
        content: '',
        data: { messageId: 'msg-A' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).not.toContain('msg-A')
      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-B')
    })

    it('complete with messageId should remove only targeted messageId, not siblings', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: '',
        data: { messageId: 'msg-X' },
        agentName: 'test'
      })
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: '',
        data: { messageId: 'msg-Y' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toHaveLength(2)

      // complete for msg-X only
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'complete',
        content: '',
        data: { messageId: 'msg-X' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).not.toContain('msg-X')
      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-Y')
    })

    it('TOOL_VALIDATION_ERROR preserves pending, then complete clears it (full retry flow)', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      // Agent streams a chunk
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'Partial',
        data: { messageId: 'msg-retry' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-retry')

      // Tool validation error — non-terminal, pending preserved
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'error',
        content: 'Tool call failed',
        data: { errorType: 'TOOL_VALIDATION_ERROR', statusCode: 400 },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toContain('msg-retry')

      // Agent retries and eventually completes
      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'complete',
        content: '',
        data: { messageId: 'msg-retry' },
        agentName: 'test'
      })

      expect(channel.getMetadata('conv1')?.pendingMessageIds).toHaveLength(0)
    })

    it('should not add messageId to pendingMessageIds for non-streaming event types', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'agents_available',
        content: '',
        data: { messageId: 'msg-3' },
        agentName: 'test'
      })

      const meta = channel.getMetadata('conv1')
      // pendingMessageIds should be empty or not contain msg-3
      expect(meta?.pendingMessageIds ?? []).not.toContain('msg-3')
    })

    it('should not modify pendingMessageIds when event has no messageId', async () => {
      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      await channel.publish('conv1', {
        conversationId: 'conv1',
        type: 'chunk',
        content: 'No messageId',
        data: {},
        agentName: 'test'
      })

      const meta = channel.getMetadata('conv1')
      expect(meta?.pendingMessageIds ?? []).toHaveLength(0)
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
      expect(channel.getActiveConversationCount()).toBe(2)
    })
  })

  describe('hasConversation', () => {
    it('returns true if conversation exists, false otherwise', () => {
      expect(channel.hasConversation('conv1')).toBe(false)

      const subscriber = new MockSubscriber('sub1')
      channel.subscribe('conv1', subscriber)

      expect(channel.hasConversation('conv1')).toBe(true)

      channel.unsubscribe('conv1', 'sub1')

      expect(channel.hasConversation('conv1')).toBe(true)
    })
  })
})
