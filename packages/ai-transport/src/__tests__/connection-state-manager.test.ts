import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConnectionStateManager,
  type ConnectionStateManagerConfig,
  type CreateConnectionParams
} from '../connection-state-manager.js'

describe('ConnectionStateManager', () => {
  let manager: ConnectionStateManager
  let config: ConnectionStateManagerConfig
  let mockLogger: any

  beforeEach(() => {
    config = {
      recoveryWindow: 5 * 60 * 1000, // 5 minutes
      ackTimeout: 30_000 // 30 seconds
    }
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
    manager = new ConnectionStateManager(config, mockLogger)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createConnection', () => {
    it('creates a connection in connected state', () => {
      const params: CreateConnectionParams = {
        conversationId: 'conv-123',
        agentName: 'test-agent',
        context: { socketId: 'socket-1', agentName: 'test-agent' }
      }

      const data = manager.createConnection('socket-1', params)

      expect(data.conversationId).toBe('conv-123')
      expect(data.agentName).toBe('test-agent')
      expect(data.state).toBe('connected')
      expect(data.abortController).toBeNull()
      expect(data.lastDeliveredSequence).toBe(-1)
      expect(data.streamingEvents).toEqual([])
    })

    it('sets start time to current timestamp', () => {
      const before = Date.now()
      const data = manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })
      const after = Date.now()

      expect(data.startTime).toBeGreaterThanOrEqual(before)
      expect(data.startTime).toBeLessThanOrEqual(after)
    })
  })

  describe('getState', () => {
    it('returns undefined for non-existent connection', () => {
      expect(manager.getState('non-existent')).toBeUndefined()
    })

    it('returns current state for existing connection', () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      expect(manager.getState('socket-1')).toBe('connected')
    })
  })

  describe('getStateData', () => {
    it('returns undefined for non-existent connection', () => {
      expect(manager.getStateData('non-existent')).toBeUndefined()
    })

    it('returns full state data for existing connection', () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      const data = manager.getStateData('socket-1')
      expect(data).toBeDefined()
      expect(data?.conversationId).toBe('conv-1')
      expect(data?.pendingToolCalls).toBeInstanceOf(Map)
    })
  })

  describe('transitionTo', () => {
    beforeEach(() => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })
    })

    describe('valid transitions', () => {
      it('allows connected -> disconnected', () => {
        const result = manager.transitionTo('socket-1', 'disconnected')
        expect(result).toBe(true)
        expect(manager.getState('socket-1')).toBe('disconnected')
      })

      it('allows connected -> recovering (for initial recovery)', () => {
        const result = manager.transitionTo('socket-1', 'recovering')
        expect(result).toBe(true)
        expect(manager.getState('socket-1')).toBe('recovering')
      })

      it('allows connected -> cleaned', () => {
        const result = manager.transitionTo('socket-1', 'cleaned')
        expect(result).toBe(true)
        expect(manager.getState('socket-1')).toBe('cleaned')
      })

      it('allows disconnected -> recovering', () => {
        manager.transitionTo('socket-1', 'disconnected')
        const result = manager.transitionTo('socket-1', 'recovering')
        expect(result).toBe(true)
        expect(manager.getState('socket-1')).toBe('recovering')
      })

      it('allows disconnected -> connected', () => {
        manager.transitionTo('socket-1', 'disconnected')
        const result = manager.transitionTo('socket-1', 'connected')
        expect(result).toBe(true)
        expect(manager.getState('socket-1')).toBe('connected')
      })

      it('allows disconnected -> cleaned', () => {
        manager.transitionTo('socket-1', 'disconnected')
        const result = manager.transitionTo('socket-1', 'cleaned')
        expect(result).toBe(true)
        expect(manager.getState('socket-1')).toBe('cleaned')
      })

      it('allows recovering -> connected', () => {
        manager.transitionTo('socket-1', 'disconnected')
        manager.transitionTo('socket-1', 'recovering')
        const result = manager.transitionTo('socket-1', 'connected')
        expect(result).toBe(true)
        expect(manager.getState('socket-1')).toBe('connected')
      })

      it('allows recovering -> cleaned', () => {
        manager.transitionTo('socket-1', 'disconnected')
        manager.transitionTo('socket-1', 'recovering')
        const result = manager.transitionTo('socket-1', 'cleaned')
        expect(result).toBe(true)
        expect(manager.getState('socket-1')).toBe('cleaned')
      })

      it('allows idempotent transitions (same state -> same state)', () => {
        // connected -> connected
        expect(manager.transitionTo('socket-1', 'connected')).toBe(true)
        expect(manager.getState('socket-1')).toBe('connected')

        // disconnected -> disconnected
        manager.transitionTo('socket-1', 'disconnected')
        expect(manager.transitionTo('socket-1', 'disconnected')).toBe(true)
        expect(manager.getState('socket-1')).toBe('disconnected')

        // recovering -> recovering
        manager.transitionTo('socket-1', 'recovering')
        expect(manager.transitionTo('socket-1', 'recovering')).toBe(true)
        expect(manager.getState('socket-1')).toBe('recovering')
      })
    })

    describe('invalid transitions', () => {
      it('rejects cleaned -> any (terminal state)', () => {
        manager.transitionTo('socket-1', 'cleaned')

        expect(manager.transitionTo('socket-1', 'connected')).toBe(false)
        expect(manager.transitionTo('socket-1', 'disconnected')).toBe(false)
        expect(manager.transitionTo('socket-1', 'recovering')).toBe(false)
        expect(manager.getState('socket-1')).toBe('cleaned')
      })

      it('rejects transition for non-existent connection', () => {
        const result = manager.transitionTo('non-existent', 'disconnected')
        expect(result).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'connection.transition.not_found',
          expect.any(Object)
        )
      })
    })

    describe('with params', () => {
      it('sets abortController during transition', () => {
        const controller = new AbortController()
        manager.transitionTo('socket-1', 'disconnected', { abortController: controller })

        expect(manager.getStateData('socket-1')?.abortController).toBe(controller)
      })

      it('sets recoveryTimeoutId during transition', () => {
        const timeoutId = setTimeout(() => {}, 1000)
        manager.transitionTo('socket-1', 'disconnected', { recoveryTimeoutId: timeoutId })

        expect(manager.getStateData('socket-1')?.recoveryTimeoutId).toBe(timeoutId)
        clearTimeout(timeoutId)
      })

      it('sets lastDeliveredSequence during transition', () => {
        manager.transitionTo('socket-1', 'disconnected', { lastDeliveredSequence: 42 })

        expect(manager.getStateData('socket-1')?.lastDeliveredSequence).toBe(42)
      })
    })

    describe('disconnectTime tracking', () => {
      it('initializes disconnectTime as null', () => {
        expect(manager.getStateData('socket-1')?.disconnectTime).toBeNull()
      })

      it('sets disconnectTime when transitioning to disconnected', () => {
        const before = Date.now()
        manager.transitionTo('socket-1', 'disconnected')
        const after = Date.now()

        const disconnectTime = manager.getStateData('socket-1')?.disconnectTime
        expect(disconnectTime).toBeGreaterThanOrEqual(before)
        expect(disconnectTime).toBeLessThanOrEqual(after)
      })

      it('clears disconnectTime when transitioning back to connected', () => {
        manager.transitionTo('socket-1', 'disconnected')
        expect(manager.getStateData('socket-1')?.disconnectTime).not.toBeNull()

        manager.transitionTo('socket-1', 'connected')
        expect(manager.getStateData('socket-1')?.disconnectTime).toBeNull()
      })

      it('clears disconnectTime after recovering -> connected', () => {
        manager.transitionTo('socket-1', 'disconnected')
        manager.transitionTo('socket-1', 'recovering')
        manager.transitionTo('socket-1', 'connected')
        expect(manager.getStateData('socket-1')?.disconnectTime).toBeNull()
      })
    })
  })

  describe('updateConnection', () => {
    it('updates connection data without changing state', () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      const controller = new AbortController()
      const result = manager.updateConnection('socket-1', {
        abortController: controller,
        lastDeliveredSequence: 100
      })

      expect(result).toBe(true)
      const data = manager.getStateData('socket-1')
      expect(data?.abortController).toBe(controller)
      expect(data?.lastDeliveredSequence).toBe(100)
      expect(data?.state).toBe('connected') // State unchanged
    })

    it('returns false for non-existent connection', () => {
      const result = manager.updateConnection('non-existent', {
        lastDeliveredSequence: 10
      })
      expect(result).toBe(false)
    })
  })

  describe('Socket ID Migration', () => {
    beforeEach(() => {
      manager.createConnection('socket-old', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-old', agentName: 'agent' }
      })
    })

    it('migrates socket ID and preserves data', () => {
      manager.migrateSocketId('socket-old', 'socket-new')

      // New socket should have the data
      const data = manager.getStateData('socket-new')
      expect(data?.conversationId).toBe('conv-1')

      // Old socket ID resolves via migration chain (for in-flight operations)
      // This is intentional - old socket lookups still work
      const oldData = manager.getStateData('socket-old')
      expect(oldData).toBe(data) // Same object via migration chain
    })

    it('tracks migration for in-flight operations', () => {
      manager.migrateSocketId('socket-old', 'socket-new')

      // Old socket ID should resolve to new socket
      expect(manager.getEffectiveSocketId('socket-old')).toBe('socket-new')
    })

    it('follows migration chains', () => {
      manager.migrateSocketId('socket-old', 'socket-new')
      manager.migrateSocketId('socket-new', 'socket-final')

      // Should follow chain to final socket
      expect(manager.getEffectiveSocketId('socket-old')).toBe('socket-final')
      expect(manager.getEffectiveSocketId('socket-new')).toBe('socket-final')
    })

    it('detects and breaks cycles', () => {
      manager.migrateSocketId('socket-old', 'socket-new')

      // Manually create a cycle (shouldn't happen in practice)
      ;(manager as any).socketIdMigrations.set('socket-new', 'socket-old')

      // Should detect cycle and break it
      const result = manager.getEffectiveSocketId('socket-old')
      expect(result).toBeDefined()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'connection.migration.cycle_detected',
        expect.any(Object)
      )
    })

    it('clears migration chain', () => {
      manager.migrateSocketId('socket-old', 'socket-new')
      manager.clearMigrationChain('socket-old')

      // After clearing, old socket should not resolve
      expect(manager.getEffectiveSocketId('socket-old')).toBe('socket-old')
    })

    it('skips migration when oldSocketId === newSocketId', () => {
      // This happens during initial recovery with cookie-less recovery
      // where both oldSocketId and newSocketId are the same
      manager.migrateSocketId('socket-old', 'socket-old')

      // Connection should still exist (not deleted)
      const data = manager.getStateData('socket-old')
      expect(data?.conversationId).toBe('conv-1')

      // Should log debug message about skipping
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'connection.migrate.skipped_same_id',
        { socketId: 'socket-old' }
      )

      // No migration chain should be created
      expect(manager.getEffectiveSocketId('socket-old')).toBe('socket-old')
    })
  })

  describe('cleanup', () => {
    it('removes connection and cleans up resources', async () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      await manager.cleanup('socket-1')

      expect(manager.getStateData('socket-1')).toBeUndefined()
      expect(manager.hasConversation('socket-1')).toBe(false)
    })

    it('clears pending timeouts', async () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      const timeoutFn = vi.fn()
      const timeoutId = setTimeout(timeoutFn, 100)
      manager.updateConnection('socket-1', { recoveryTimeoutId: timeoutId })

      await manager.cleanup('socket-1')

      // Wait a bit to ensure timeout was cleared
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(timeoutFn).not.toHaveBeenCalled()
    })

    it('is idempotent - concurrent cleanups are safe', async () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      // Start two cleanups simultaneously
      const cleanup1 = manager.cleanup('socket-1')
      const cleanup2 = manager.cleanup('socket-1')

      await Promise.all([cleanup1, cleanup2])

      // Should only log completion once
      expect(mockLogger.info).toHaveBeenCalledTimes(1)
    })

    it('calls onCleanup hook if provided', async () => {
      const onCleanup = vi.fn()
      const managerWithHook = new ConnectionStateManager(
        { ...config, onCleanup },
        mockLogger
      )

      managerWithHook.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      await managerWithHook.cleanup('socket-1')

      expect(onCleanup).toHaveBeenCalledWith(
        'socket-1',
        expect.objectContaining({ conversationId: 'conv-1' })
      )
    })

    it('clears migrations pointing to cleaned socket', async () => {
      manager.createConnection('socket-old', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-old', agentName: 'agent' }
      })
      manager.migrateSocketId('socket-old', 'socket-new')

      await manager.cleanup('socket-new')

      // Migration should be cleared
      expect(manager.getEffectiveSocketId('socket-old')).toBe('socket-old')
    })
  })

  describe('isCleanupInProgress', () => {
    it('returns false initially', () => {
      expect(manager.isCleanupInProgress('socket-1')).toBe(false)
    })

    it('returns true during cleanup', async () => {
      const slowCleanup = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
      })
      const managerWithSlowCleanup = new ConnectionStateManager(
        { ...config, onCleanup: slowCleanup },
        mockLogger
      )

      managerWithSlowCleanup.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      const cleanupPromise = managerWithSlowCleanup.cleanup('socket-1')

      // Check during cleanup
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(managerWithSlowCleanup.isCleanupInProgress('socket-1')).toBe(true)

      await cleanupPromise
      expect(managerWithSlowCleanup.isCleanupInProgress('socket-1')).toBe(false)
    })
  })

  describe('queueMessage', () => {
    it('executes handler and returns result', async () => {
      const handler = vi.fn().mockResolvedValue('result')

      const result = await manager.queueMessage('socket-1', handler)

      expect(result).toBe('result')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('serializes concurrent handlers for same socket', async () => {
      const executionOrder: number[] = []

      const handler1 = async () => {
        executionOrder.push(1)
        await new Promise(resolve => setTimeout(resolve, 50))
        executionOrder.push(2)
        return 'first'
      }

      const handler2 = async () => {
        executionOrder.push(3)
        return 'second'
      }

      // Start both handlers "simultaneously"
      const [result1, result2] = await Promise.all([
        manager.queueMessage('socket-1', handler1),
        manager.queueMessage('socket-1', handler2)
      ])

      expect(result1).toBe('first')
      expect(result2).toBe('second')
      // Handler 2 should not start until handler 1 completes
      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('allows parallel execution for different sockets', async () => {
      const executionOrder: string[] = []

      const handler1 = async () => {
        executionOrder.push('socket-1 start')
        await new Promise(resolve => setTimeout(resolve, 50))
        executionOrder.push('socket-1 end')
        return 'first'
      }

      const handler2 = async () => {
        executionOrder.push('socket-2 start')
        await new Promise(resolve => setTimeout(resolve, 10))
        executionOrder.push('socket-2 end')
        return 'second'
      }

      await Promise.all([
        manager.queueMessage('socket-1', handler1),
        manager.queueMessage('socket-2', handler2)
      ])

      // socket-2 should complete before socket-1 (parallel execution)
      expect(executionOrder.indexOf('socket-2 end'))
        .toBeLessThan(executionOrder.indexOf('socket-1 end'))
    })

    it('propagates errors from handler', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('test error'))

      await expect(manager.queueMessage('socket-1', handler)).rejects.toThrow('test error')
    })

    it('continues queue after handler error', async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error('error'))
      const successHandler = vi.fn().mockResolvedValue('success')

      // First handler fails
      await expect(manager.queueMessage('socket-1', failingHandler)).rejects.toThrow()

      // Second handler should still execute
      const result = await manager.queueMessage('socket-1', successHandler)
      expect(result).toBe('success')
    })
  })

  describe('helper queries', () => {
    beforeEach(() => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })
    })

    describe('hasActiveStream', () => {
      it('returns false when no controller', () => {
        expect(manager.hasActiveStream('socket-1')).toBe(false)
      })

      it('returns true when controller present and connected', () => {
        manager.updateConnection('socket-1', {
          abortController: new AbortController()
        })
        expect(manager.hasActiveStream('socket-1')).toBe(true)
      })

      it('returns false when disconnected even with controller', () => {
        manager.updateConnection('socket-1', {
          abortController: new AbortController()
        })
        manager.transitionTo('socket-1', 'disconnected')
        expect(manager.hasActiveStream('socket-1')).toBe(false)
      })
    })

    describe('hasConversation', () => {
      it('returns true for existing connection', () => {
        expect(manager.hasConversation('socket-1')).toBe(true)
      })

      it('returns false for non-existent connection', () => {
        expect(manager.hasConversation('non-existent')).toBe(false)
      })
    })

    describe('isInRecoveryWindow', () => {
      it('returns false for connected socket', () => {
        expect(manager.isInRecoveryWindow('socket-1')).toBe(false)
      })

      it('returns true for disconnected socket with timeout', () => {
        const timeoutId = setTimeout(() => {}, 1000)
        manager.transitionTo('socket-1', 'disconnected', {
          recoveryTimeoutId: timeoutId
        })

        expect(manager.isInRecoveryWindow('socket-1')).toBe(true)
        clearTimeout(timeoutId)
      })
    })

    describe('getConversationId', () => {
      it('returns conversation ID', () => {
        expect(manager.getConversationId('socket-1')).toBe('conv-1')
      })

      it('returns undefined for non-existent connection', () => {
        expect(manager.getConversationId('non-existent')).toBeUndefined()
      })
    })

    describe('getAbortController', () => {
      it('returns null when no controller', () => {
        expect(manager.getAbortController('socket-1')).toBeNull()
      })

      it('returns controller when set', () => {
        const controller = new AbortController()
        manager.updateConnection('socket-1', { abortController: controller })
        expect(manager.getAbortController('socket-1')).toBe(controller)
      })
    })
  })

  describe('streaming events', () => {
    beforeEach(() => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })
    })

    it('adds streaming events', () => {
      const event = { type: 'chunk', content: 'hello', timestamp: new Date() }
      const result = manager.addStreamingEvent('socket-1', event)

      expect(result).toBe(true)
      expect(manager.getStreamingEvents('socket-1')).toContain(event)
    })

    it('returns false for non-existent connection', () => {
      const event = { type: 'chunk', content: 'hello', timestamp: new Date() }
      const result = manager.addStreamingEvent('non-existent', event)

      expect(result).toBe(false)
    })

    it('returns empty array for non-existent connection', () => {
      expect(manager.getStreamingEvents('non-existent')).toEqual([])
    })
  })

  describe('utility methods', () => {
    it('getActiveConnectionCount returns correct count', () => {
      expect(manager.getActiveConnectionCount()).toBe(0)

      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })
      expect(manager.getActiveConnectionCount()).toBe(1)

      manager.createConnection('socket-2', {
        conversationId: 'conv-2',
        agentName: 'agent',
        context: { socketId: 'socket-2', agentName: 'agent' }
      })
      expect(manager.getActiveConnectionCount()).toBe(2)
    })

    it('getDisconnectedCount returns correct count', () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })
      manager.createConnection('socket-2', {
        conversationId: 'conv-2',
        agentName: 'agent',
        context: { socketId: 'socket-2', agentName: 'agent' }
      })

      expect(manager.getDisconnectedCount()).toBe(0)

      manager.transitionTo('socket-1', 'disconnected')
      expect(manager.getDisconnectedCount()).toBe(1)

      manager.transitionTo('socket-2', 'disconnected')
      expect(manager.getDisconnectedCount()).toBe(2)
    })

    it('isDisconnected returns correct value', () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })

      expect(manager.isDisconnected('socket-1')).toBe(false)

      manager.transitionTo('socket-1', 'disconnected')
      expect(manager.isDisconnected('socket-1')).toBe(true)
    })

    it('getDisconnectedSocketIds returns set of disconnected sockets', () => {
      manager.createConnection('socket-1', {
        conversationId: 'conv-1',
        agentName: 'agent',
        context: { socketId: 'socket-1', agentName: 'agent' }
      })
      manager.createConnection('socket-2', {
        conversationId: 'conv-2',
        agentName: 'agent',
        context: { socketId: 'socket-2', agentName: 'agent' }
      })

      manager.transitionTo('socket-1', 'disconnected')

      const disconnected = manager.getDisconnectedSocketIds()
      expect(disconnected.has('socket-1')).toBe(true)
      expect(disconnected.has('socket-2')).toBe(false)
    })
  })
})
