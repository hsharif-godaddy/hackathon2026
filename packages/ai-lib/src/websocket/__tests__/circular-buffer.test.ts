import { describe, it, expect, beforeEach } from 'vitest'
import { CircularBuffer } from '../conversation-event-channel.js'
import type { StreamingEvent } from '../interfaces.js'

/**
 * Helper function to create a test event
 */
function createTestEvent(sequence: number, overrides?: Partial<StreamingEvent>): StreamingEvent {
  return {
    id: `event-${sequence}`,
    conversationId: 'test-conversation',
    sequence,
    type: 'chunk',
    content: `Test content ${sequence}`,
    data: {},
    timestamp: new Date(Date.now() + sequence * 1000), // Each event 1 second apart
    agentName: 'test-agent',
    ...overrides
  }
}

describe('CircularBuffer', () => {
  describe('constructor', () => {
    it('initializes with correct capacity', () => {
      const buffer = new CircularBuffer<StreamingEvent>(100)
      expect(buffer.size()).toBe(0)
      expect(buffer.getAll()).toEqual([])
    })

    it('throws error for invalid capacity', () => {
      expect(() => new CircularBuffer<StreamingEvent>(0)).toThrow(
        'Circular buffer capacity must be at least 1'
      )
      expect(() => new CircularBuffer<StreamingEvent>(-1)).toThrow(
        'Circular buffer capacity must be at least 1'
      )
    })
  })

  describe('push', () => {
    let buffer: CircularBuffer<StreamingEvent>

    beforeEach(() => {
      buffer = new CircularBuffer<StreamingEvent>(3)
    })

    it('adds events and increments write index', () => {
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)

      buffer.push(event1)
      expect(buffer.size()).toBe(1)

      buffer.push(event2)
      expect(buffer.size()).toBe(2)

      const allEvents = buffer.getAll()
      expect(allEvents).toHaveLength(2)
      expect(allEvents[0]).toEqual(event1)
      expect(allEvents[1]).toEqual(event2)
    })

    it('overwrites oldest event when buffer is full', () => {
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)
      const event3 = createTestEvent(2)
      const event4 = createTestEvent(3)

      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3)
      expect(buffer.size()).toBe(3)

      // Buffer is full, next push should overwrite oldest
      buffer.push(event4)
      expect(buffer.size()).toBe(3)

      const allEvents = buffer.getAll()
      expect(allEvents).toHaveLength(3)
      expect(allEvents[0]).toEqual(event2) // event1 was overwritten
      expect(allEvents[1]).toEqual(event3)
      expect(allEvents[2]).toEqual(event4)
    })

    it('correctly handles wrap-around for large number of events', () => {
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)
      const event3 = createTestEvent(2)
      const event4 = createTestEvent(3)
      const event5 = createTestEvent(4)
      const event6 = createTestEvent(5)

      // Fill buffer twice to test wrap-around
      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3)
      buffer.push(event4) // Overwrites event1
      buffer.push(event5) // Overwrites event2
      buffer.push(event6) // Overwrites event3

      const allEvents = buffer.getAll()
      expect(allEvents).toHaveLength(3)
      expect(allEvents[0]).toEqual(event4)
      expect(allEvents[1]).toEqual(event5)
      expect(allEvents[2]).toEqual(event6)
    })
  })

  describe('size', () => {
    it('returns correct count of buffered events', () => {
      const buffer = new CircularBuffer<StreamingEvent>(5)

      expect(buffer.size()).toBe(0)

      buffer.push(createTestEvent(0))
      expect(buffer.size()).toBe(1)

      buffer.push(createTestEvent(1))
      expect(buffer.size()).toBe(2)

      buffer.push(createTestEvent(2))
      expect(buffer.size()).toBe(3)
    })

    it('returns capacity when buffer is full', () => {
      const buffer = new CircularBuffer<StreamingEvent>(3)

      buffer.push(createTestEvent(0))
      buffer.push(createTestEvent(1))
      buffer.push(createTestEvent(2))
      expect(buffer.size()).toBe(3)

      // Overwrite oldest - size should still be 3
      buffer.push(createTestEvent(3))
      expect(buffer.size()).toBe(3)
    })
  })

  describe('get', () => {
    it('retrieves event by sequence number', () => {
      const buffer = new CircularBuffer<StreamingEvent>(10)
      const event1 = createTestEvent(5)
      const event2 = createTestEvent(10)
      const event3 = createTestEvent(15)

      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3)

      expect(buffer.get(5)).toEqual(event1)
      expect(buffer.get(10)).toEqual(event2)
      expect(buffer.get(15)).toEqual(event3)
    })

    it('returns null for non-existent sequence', () => {
      const buffer = new CircularBuffer<StreamingEvent>(10)
      buffer.push(createTestEvent(0))

      expect(buffer.get(999)).toBeNull()
    })

    it('returns null after event is overwritten', () => {
      const buffer = new CircularBuffer<StreamingEvent>(2)
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)
      const event3 = createTestEvent(2)

      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3) // Overwrites event1

      expect(buffer.get(0)).toBeNull() // event1 no longer in buffer
      expect(buffer.get(1)).toEqual(event2)
      expect(buffer.get(2)).toEqual(event3)
    })
  })

  describe('getAll', () => {
    it('returns all events in chronological order', () => {
      const buffer = new CircularBuffer<StreamingEvent>(5)
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)
      const event3 = createTestEvent(2)

      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3)

      const allEvents = buffer.getAll()
      expect(allEvents).toHaveLength(3)
      expect(allEvents[0]).toEqual(event1)
      expect(allEvents[1]).toEqual(event2)
      expect(allEvents[2]).toEqual(event3)
    })

    it('returns empty array for empty buffer', () => {
      const buffer = new CircularBuffer<StreamingEvent>(5)
      expect(buffer.getAll()).toEqual([])
    })

    it('returns events in correct order after wrap-around', () => {
      const buffer = new CircularBuffer<StreamingEvent>(3)
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)
      const event3 = createTestEvent(2)
      const event4 = createTestEvent(3)

      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3)
      buffer.push(event4) // Overwrites event1

      const allEvents = buffer.getAll()
      expect(allEvents).toHaveLength(3)
      expect(allEvents[0]).toEqual(event2)
      expect(allEvents[1]).toEqual(event3)
      expect(allEvents[2]).toEqual(event4)
    })
  })

  describe('getEventsSince', () => {
    it('returns events after specified sequence', () => {
      const buffer = new CircularBuffer<StreamingEvent>(10)
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)
      const event3 = createTestEvent(2)
      const event4 = createTestEvent(3)

      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3)
      buffer.push(event4)

      const eventsSince = buffer.getEventsSince(1)
      expect(eventsSince).toHaveLength(2)
      expect(eventsSince[0]).toEqual(event3) // sequence 2
      expect(eventsSince[1]).toEqual(event4) // sequence 3
    })

    it('returns empty array when no events after sequence', () => {
      const buffer = new CircularBuffer<StreamingEvent>(10)
      buffer.push(createTestEvent(0))
      buffer.push(createTestEvent(1))

      const eventsSince = buffer.getEventsSince(10)
      expect(eventsSince).toEqual([])
    })

    it('returns all events when querying from sequence 0', () => {
      const buffer = new CircularBuffer<StreamingEvent>(10)
      const event1 = createTestEvent(1)
      const event2 = createTestEvent(2)
      const event3 = createTestEvent(3)

      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3)

      const eventsSince = buffer.getEventsSince(0)
      expect(eventsSince).toHaveLength(3)
      expect(eventsSince[0]).toEqual(event1)
      expect(eventsSince[1]).toEqual(event2)
      expect(eventsSince[2]).toEqual(event3)
    })

    it('handles wrap-around correctly', () => {
      const buffer = new CircularBuffer<StreamingEvent>(3)
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)
      const event3 = createTestEvent(2)
      const event4 = createTestEvent(3)
      const event5 = createTestEvent(4)

      buffer.push(event1)
      buffer.push(event2)
      buffer.push(event3)
      buffer.push(event4) // Overwrites event1
      buffer.push(event5) // Overwrites event2

      // Query for events after sequence 2 (should get event4 and event5)
      const eventsSince = buffer.getEventsSince(2)
      expect(eventsSince).toHaveLength(2)
      expect(eventsSince[0]).toEqual(event4) // sequence 3
      expect(eventsSince[1]).toEqual(event5) // sequence 4
    })
  })

  describe('getOldestTimestamp', () => {
    it('returns timestamp of oldest event', () => {
      const buffer = new CircularBuffer<StreamingEvent>(10)
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)

      buffer.push(event1)
      buffer.push(event2)

      expect(buffer.getOldestTimestamp()).toEqual(event1.timestamp)
    })

    it('returns null for empty buffer', () => {
      const buffer = new CircularBuffer<StreamingEvent>(10)
      expect(buffer.getOldestTimestamp()).toBeNull()
    })

    it('returns timestamp of current oldest after wrap-around', () => {
      const buffer = new CircularBuffer<StreamingEvent>(2)
      const event1 = createTestEvent(0)
      const event2 = createTestEvent(1)
      const event3 = createTestEvent(2)

      buffer.push(event1)
      buffer.push(event2)
      expect(buffer.getOldestTimestamp()).toEqual(event1.timestamp)

      buffer.push(event3) // Overwrites event1
      expect(buffer.getOldestTimestamp()).toEqual(event2.timestamp)
    })
  })

  describe('clear', () => {
    it('empties buffer and resets indices', () => {
      const buffer = new CircularBuffer<StreamingEvent>(10)
      buffer.push(createTestEvent(0))
      buffer.push(createTestEvent(1))
      buffer.push(createTestEvent(2))

      expect(buffer.size()).toBe(3)

      buffer.clear()

      expect(buffer.size()).toBe(0)
      expect(buffer.getAll()).toEqual([])
      expect(buffer.getOldestTimestamp()).toBeNull()
    })

    it('allows adding new events after clear', () => {
      const buffer = new CircularBuffer<StreamingEvent>(5)
      buffer.push(createTestEvent(0))
      buffer.push(createTestEvent(1))

      buffer.clear()

      const newEvent = createTestEvent(10)
      buffer.push(newEvent)

      expect(buffer.size()).toBe(1)
      expect(buffer.getAll()).toEqual([newEvent])
    })
  })
})
