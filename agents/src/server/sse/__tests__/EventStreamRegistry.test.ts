import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SSEWriter } from '@airo/ai-transport'
import { EventStreamRegistry } from '../EventStreamRegistry.js'

function createMockWriter(): SSEWriter {
  let closed = false
  return {
    encoding: 'identity',
    write: vi.fn(),
    comment: vi.fn(),
    retry: vi.fn(),
    end: vi.fn(() => { closed = true }),
    isClosed: () => closed,
  }
}

describe('EventStreamRegistry', () => {
  let registry: EventStreamRegistry

  beforeEach(() => {
    registry = new EventStreamRegistry()
  })

  it('registers a connection for a conversation and returns subscriber', () => {
    const writer = createMockWriter()
    const result = registry.register('conv_1', 'app_1', writer)
    expect(result.subscriber).toBeDefined()
    expect(registry.getConnectionCount('conv_1')).toBe(1)
  })

  it('returns SSESubscribers for a conversation', () => {
    const writer = createMockWriter()
    registry.register('conv_1', 'app_1', writer)
    const subscribers = registry.getSubscribers('conv_1')
    expect(subscribers).toHaveLength(1)
    expect(subscribers[0]!.id).toMatch(/^sse-app_1-/)
  })

  it('returns empty array for unknown conversation', () => {
    expect(registry.getSubscribers('unknown')).toEqual([])
  })

  it('unregister removes the connection', () => {
    const writer = createMockWriter()
    const { subscriber } = registry.register('conv_1', 'app_1', writer)
    expect(registry.getConnectionCount('conv_1')).toBe(1)

    registry.unregister('conv_1', subscriber)
    expect(registry.getConnectionCount('conv_1')).toBe(0)
  })

  it('supports multiple connections per conversation', () => {
    const w1 = createMockWriter()
    const w2 = createMockWriter()
    registry.register('conv_1', 'app_1', w1)
    registry.register('conv_1', 'app_1', w2)
    expect(registry.getConnectionCount('conv_1')).toBe(2)
  })

  it('hasConnections returns true when connections exist', () => {
    const writer = createMockWriter()
    registry.register('conv_1', 'app_1', writer)
    expect(registry.hasConnections('conv_1')).toBe(true)
    expect(registry.hasConnections('conv_2')).toBe(false)
  })

  it('sendToAll sends to all connections for conversation', () => {
    const w1 = createMockWriter()
    const w2 = createMockWriter()
    registry.register('conv_1', 'app_1', w1)
    registry.register('conv_1', 'app_1', w2)

    registry.sendToAll('conv_1', 'test', { foo: 'bar' })

    expect(w1.write).toHaveBeenCalledTimes(1)
    expect(w2.write).toHaveBeenCalledTimes(1)
  })

  it('sendToAll does not send to different conversation', () => {
    const w1 = createMockWriter()
    const w2 = createMockWriter()
    registry.register('conv_1', 'app_1', w1)
    registry.register('conv_2', 'app_1', w2)

    registry.sendToAll('conv_1', 'test', { foo: 'bar' })

    expect(w1.write).toHaveBeenCalledTimes(1)
    expect(w2.write).not.toHaveBeenCalled()
  })

  it('getAppForConversation returns appId for known conversation', () => {
    const writer = createMockWriter()
    registry.register('conv_1', 'app_1', writer)
    expect(registry.getAppForConversation('conv_1')).toBe('app_1')
  })

  it('getAppForConversation returns undefined for unknown conversation', () => {
    expect(registry.getAppForConversation('unknown')).toBeUndefined()
  })

  it('evicts oldest connection when capacity is exceeded and ends its writer', () => {
    const writers: SSEWriter[] = []
    for (let i = 0; i < 10; i++) {
      const w = createMockWriter()
      writers.push(w)
      registry.register('conv_1', 'app_1', w)
    }
    expect(registry.getConnectionCount('conv_1')).toBe(10)

    const newWriter = createMockWriter()
    registry.register('conv_1', 'app_1', newWriter)

    // Still 10: oldest evicted, new one added
    expect(registry.getConnectionCount('conv_1')).toBe(10)
    // Oldest writer got .end() called
    expect(writers[0]!.end).toHaveBeenCalled()
  })

  it('sendToAll removes connections whose writer throws', () => {
    const good = createMockWriter()
    const bad = createMockWriter()
    ;(bad.write as any).mockImplementation(() => { throw new Error('broken pipe') })

    registry.register('conv_1', 'app_1', good)
    registry.register('conv_1', 'app_1', bad)
    expect(registry.getConnectionCount('conv_1')).toBe(2)

    registry.sendToAll('conv_1', 'test', { foo: 'bar' })

    expect(registry.getConnectionCount('conv_1')).toBe(1)
    // Good connection still receives
    expect(good.write).toHaveBeenCalled()
  })

  // Regression: a throw from writer.end() during eviction used to propagate
  // out of register(), leaving the new connection un-added and the map in an
  // inconsistent state. removeConnection now isolates each step.
  it('eviction path still completes when writer.end() throws', () => {
    for (let i = 0; i < 10; i++) {
      const w = createMockWriter()
      ;(w.end as any).mockImplementation(() => { throw new Error('zlib destroyed') })
      registry.register('conv_1', 'app_1', w)
    }
    expect(registry.getConnectionCount('conv_1')).toBe(10)

    const newWriter = createMockWriter()
    expect(() => registry.register('conv_1', 'app_1', newWriter)).not.toThrow()

    expect(registry.getConnectionCount('conv_1')).toBe(10)
  })

  describe('app-scoped fan-out', () => {
    it('getConversationsByApp returns only conversations that have a connection for the app', () => {
      registry.register('conv_a', 'app_X', createMockWriter())
      registry.register('conv_b', 'app_Y', createMockWriter())
      registry.register('conv_c', 'app_X', createMockWriter())

      expect(registry.getConversationsByApp('app_X').sort()).toEqual(['conv_a', 'conv_c'])
      expect(registry.getConversationsByApp('app_Y')).toEqual(['conv_b'])
      expect(registry.getConversationsByApp('app_unknown')).toEqual([])
    })

    it('getConversationsByApp dedupes conversations with multiple connections', () => {
      registry.register('conv_a', 'app_X', createMockWriter())
      registry.register('conv_a', 'app_X', createMockWriter())

      expect(registry.getConversationsByApp('app_X')).toEqual(['conv_a'])
    })

    it('sendToApp writes to every connection for the app and skips other apps', () => {
      const xWriter1 = createMockWriter()
      const xWriter2 = createMockWriter()
      const yWriter = createMockWriter()

      registry.register('conv_a', 'app_X', xWriter1)
      registry.register('conv_b', 'app_X', xWriter2)
      registry.register('conv_c', 'app_Y', yWriter)

      registry.sendToApp('app_X', 'kick', { reason: 'test' })

      expect(xWriter1.write).toHaveBeenCalled()
      expect(xWriter2.write).toHaveBeenCalled()
      expect(yWriter.write).not.toHaveBeenCalled()

      const written = (xWriter1.write as any).mock.calls[0][0] as string
      expect(written).toContain('event: kick')
      expect(written).toContain('"reason":"test"')
    })

    it('sendToApp is a no-op when no connections match the appId', () => {
      registry.register('conv_a', 'app_X', createMockWriter())

      expect(() => registry.sendToApp('app_unknown', 'noop', {})).not.toThrow()
    })
  })

  it('sendToAll drops the event silently when the payload is unserializable', () => {
    // A BigInt in data used to throw JSON.stringify synchronously, escaping
    // every caller of sendToAll. safeFormatSSEEvent now catches and returns
    // null so the call becomes a no-op.
    const writer = createMockWriter()
    registry.register('conv_1', 'app_1', writer)

    expect(() => registry.sendToAll('conv_1', 'bad', { big: BigInt(1) })).not.toThrow()
    expect(writer.write).not.toHaveBeenCalled()
  })

  it('sendToAll cleanup survives dispose() throwing on a dead connection', () => {
    const bad = createMockWriter()
    ;(bad.write as any).mockImplementation(() => { throw new Error('write after end') })

    const { subscriber } = registry.register('conv_1', 'app_1', bad)
    // Force dispose() to throw — sendToAll must still prune the connection.
    ;(subscriber as any).dispose = () => { throw new Error('dispose failed') }

    expect(() => registry.sendToAll('conv_1', 'evt', {})).not.toThrow()
    expect(registry.getConnectionCount('conv_1')).toBe(0)
  })
})
