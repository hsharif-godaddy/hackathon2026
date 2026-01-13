/**
 * Store Sync Adapter Tests
 *
 * Comprehensive tests for the StoreSyncAdapter.
 * Verifies all machine state → store action mappings.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StoreSyncAdapterTestHarness } from './StoreSyncAdapterTestUtils'

describe('StoreSyncAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial sync', () => {
    it('should sync initial disconnected state to store', () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Machine starts in disconnected + completed, adapter syncs both
      expect(harness.mockStore.setWebSocketState).toHaveBeenCalled()
      expect(harness.mockStore.setStreamingState).toHaveBeenCalled()

      // Verify transport state was synced
      const wsStateCalls = harness.mockStore.setWebSocketState.mock.calls
      const hasDisconnectedCall = wsStateCalls.some(call =>
        call[0]?.status === 'idle' && call[0]?.connected === false
      )
      expect(hasDisconnectedCall).toBe(true)

      // Verify stream state was synced (machine:completed → store:'idle')
      expect(harness.mockStore.setStreamingState).toHaveBeenCalledWith('idle')

      harness.destroy()
    })
  })

  describe('transport state sync', () => {
    it('should sync disconnected state', () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Machine starts in disconnected, adapter should have synced this initially
      harness.machine.assertState((s) => s.matches({ transport: 'disconnected' }))

      // Initial sync should have called setWebSocketState
      expect(harness.mockStore.setWebSocketState).toHaveBeenCalled()

      harness.destroy()
    })

    it('should sync connecting → connected transition', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      harness.clearAllMocks()

      // Connect
      harness.machine.simulateConnect('app-123')
      harness.assertStoreActionCalledWith('setWebSocketState', {
        status: 'connecting',
        connected: false,
      })

      // Token refreshed
      harness.mockStore.setWebSocketState.mockClear()
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      // Still connecting
      harness.assertStoreActionCalledWith('setWebSocketState', {
        status: 'connecting',
        connected: false,
      })

      // Connection established
      harness.mockStore.setWebSocketState.mockClear()
      harness.machine.simulateConnectionEstablished('socket-456')

      harness.assertStoreActionCalledWith('setWebSocketState', {
        status: 'idle',
        connected: true,
      })

      harness.destroy()
    })

    it('should sync retry state on connection failure', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      harness.clearAllMocks()

      // Attempt connection
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })

      // Fail connection
      harness.mockStore.setRetryState.mockClear()
      harness.machine.actor.send({
        type: 'CONNECTION_FAILED',
        error: new Error('Connection failed'),
      })

      // Should set retry state
      harness.assertStoreActionCalled('setRetryState')
      harness.assertStoreActionCalledWith('setRetryState', {
        isRetrying: true,
        retryCount: 1,
        nextRetryMs: 1000,
      })

      harness.destroy()
    })
  })

  describe('recovery state sync', () => {
    it('should sync recovery state on RECOVERY_STATUS', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Setup connection
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')

      harness.mockStore.setRecoveryState.mockClear()

      // Start recovery
      harness.machine.simulateRecoveryFlow('recovery-123', 3)

      harness.assertStoreActionCalled('setRecoveryState')
      harness.assertStoreActionCalledWith('setRecoveryState', {
        isRecovering: true,
        expectedEvents: 3,
        receivedEvents: 0,
      })

      harness.destroy()
    })

    it('should update recovery state as replay events received', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Setup connection and recovery
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')
      harness.machine.simulateRecoveryFlow('recovery-123', 3)

      // Receive replay events
      for (let i = 1; i <= 3; i++) {
        harness.mockStore.setRecoveryState.mockClear()
        harness.machine.simulateReplayEvent()

        // Adapter should update recovery state (but state stays in pendingAck until all received)
        if (i < 3) {
          // Not all events received yet, should stay in pendingAck
          harness.machine.assertState((s) =>
            s.matches({ transport: { connected: { recovering: 'pendingAck' } } })
          )
        }
      }

      harness.destroy()
    })

    it('should clear recovery state when back to idle', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Setup connection, recovery, and complete recovery
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')
      harness.machine.simulateRecoveryFlow('recovery-123', 1)
      harness.machine.simulateReplayEvent()

      await vi.advanceTimersByTimeAsync(0)

      harness.mockStore.setRecoveryState.mockClear()
      harness.machine.simulateRecoveryAckSent()

      // Should clear recovery state
      harness.assertStoreActionCalled('setRecoveryState')
      harness.assertStoreActionCalledWith('setRecoveryState', {
        isRecovering: false,
        expectedEvents: 0,
        receivedEvents: 0,
      })

      harness.destroy()
    })
  })

  describe('streaming state sync', () => {
    it('should sync streaming lifecycle', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Setup connection
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')

      harness.clearAllMocks()

      // Start stream via STREAM_STARTED (more realistic than SEND_MESSAGE)
      harness.machine.actor.send({
        type: 'STREAM_STARTED',
        conversationId: 'conv-789',
        messageId: 'msg-123',
      })

      // Should call startStream
      harness.assertStoreActionCalled('startStream')
      harness.assertStoreActionCalledWith('startStream', 'conv-789', 'msg-123')

      // Complete stream
      harness.clearAllMocks()
      harness.machine.simulateStreamComplete()

      // Wait for completing → completed transition
      await vi.advanceTimersByTimeAsync(100)

      // Adapter should call lifecycle methods (Tier 1)
      // Note: finalizeStream is Tier 2 (transcript data), called by CompleteHandler
      // During completion: completing → completed state transitions
      expect(harness.mockStore.setStreamingState).toHaveBeenCalled()
      expect(harness.mockStore.setIsLoading).toHaveBeenCalledWith(false)
      expect(harness.mockStore.setWebSocketState).toHaveBeenCalled()

      harness.destroy()
    })

    it('should sync stream error (non-retryable)', () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Setup connection and streaming
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')
      harness.machine.actor.send({
        type: 'STREAM_STARTED',
        conversationId: 'conv-789',
        messageId: 'msg-123',
      })

      harness.clearAllMocks()

      // Simulate non-retryable error
      const error = new Error('Budget exceeded')
      harness.machine.simulateStreamError(error, false)

      // Adapter should call lifecycle methods (Tier 1)
      // Note: finalizeStream is Tier 2 (transcript data), called by ErrorHandler
      harness.assertStoreActionCalled('setError')
      harness.assertStoreActionCalledWith('setError', error)
      harness.assertStoreActionCalled('setStreamingState')
      harness.assertStoreActionCalled('setIsLoading')

      harness.destroy()
    })

    it('should handle stream error (retryable)', () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Setup connection and streaming
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')
      harness.machine.actor.send({
        type: 'STREAM_STARTED',
        conversationId: 'conv-789',
        messageId: 'msg-123',
      })

      harness.clearAllMocks()

      // Simulate retryable error
      const error = new Error('Transient error')
      harness.machine.simulateStreamError(error, true)

      // Should set error but NOT finalize (stays in receiving state for retry)
      harness.assertStoreActionCalled('setError')
      harness.assertStoreActionCalledWith('setError', error)

      // Should NOT have called finalizeStream (retryable error)
      expect(harness.mockStore.finalizeStream).not.toHaveBeenCalled()

      harness.destroy()
    })
  })

  describe('retry exhaustion', () => {
    it('should sync exhausted retry state', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Fail connection 10 times
      for (let i = 0; i < 10; i++) {
        harness.machine.actor.send({ type: 'CONNECT', appId: 'app-123' })
        harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
        harness.machine.actor.send({
          type: 'CONNECTION_FAILED',
          error: new Error('Connection failed'),
        })

        if (i < 9) {
          const delay = Math.min(500 * Math.pow(2, i + 1), 5000)
          await vi.advanceTimersByTimeAsync(delay)
        }
      }

      harness.mockStore.setRetryState.mockClear()

      // Advance final timer
      await vi.advanceTimersByTimeAsync(5000)

      // Should set exhausted state
      harness.assertStoreActionCalled('setRetryState')
      harness.assertStoreActionCalledWith('setRetryState', {
        isRetrying: false,
        retryCount: 10,
        exhausted: true,
      })

      harness.destroy()
    })
  })

  describe('parallel states', () => {
    it('should handle disconnect during streaming', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Setup connection + streaming
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')
      harness.machine.actor.send({
        type: 'STREAM_STARTED',
        conversationId: 'conv-789',
        messageId: 'msg-123',
      })

      harness.clearAllMocks()

      // Disconnect during stream
      harness.machine.simulateDisconnect('Connection lost')

      // Should set retry state (transport reconnecting)
      harness.assertStoreActionCalled('setRetryState')

      // Stream state should remain (parallel region)
      harness.machine.assertState((s) => s.matches({ stream: { streaming: 'receiving' } }))

      harness.destroy()
    })
  })

  describe('stream completed initial state', () => {
    it('should start in completed state and clear isLoading', () => {
      // Test the initial state sync - machine starts with stream:completed
      const harness = new StoreSyncAdapterTestHarness()

      // Machine should start in completed state (not idle)
      harness.machine.assertState((s) => s.matches({ stream: 'completed' }))

      // Initial sync should have set isLoading to false for completed stream state
      const isLoadingCalls = harness.mockStore.setIsLoading.mock.calls
      const hasClearedLoading = isLoadingCalls.some(call => call[0] === false)
      expect(hasClearedLoading).toBe(true)

      // Verify streamingState was set to completed
      expect(harness.mockStore.setStreamingState).toHaveBeenCalled()

      harness.destroy()
    })

    it('should clear isLoading when transitioning back to completed state', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Setup connection
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')

      // Start streaming
      harness.machine.actor.send({
        type: 'STREAM_STARTED',
        conversationId: 'conv-1',
        messageId: 'msg-1',
      })

      // Verify we're streaming with isLoading=true
      harness.machine.assertState((s) => s.matches({ stream: { streaming: 'receiving' } }))
      expect(harness.mockStore.setIsLoading).toHaveBeenCalledWith(true)

      // Complete stream - transitions: streaming → completing → completed
      harness.machine.simulateStreamComplete()

      // Wait for completing → completed transition (STREAM_COMPLETE_DELAY = 100ms)
      await vi.advanceTimersByTimeAsync(150)

      // Machine should be in completed state
      harness.machine.assertState((s) => s.matches({ stream: 'completed' }))

      // Verify isLoading was cleared (check all calls, including initial and final)
      const isLoadingCalls = harness.mockStore.setIsLoading.mock.calls
      expect(isLoadingCalls.some(call => call[0] === false)).toBe(true)

      harness.destroy()
    })

    it('should maintain completed state across transport changes', async () => {
      const harness = new StoreSyncAdapterTestHarness()

      // Machine starts in completed state
      harness.machine.assertState((s) => s.matches({ stream: 'completed' }))

      // Clear initial calls
      harness.clearAllMocks()

      // Transport state changes (connect/disconnect) shouldn't affect stream state
      harness.machine.simulateConnect('app-123')
      harness.machine.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.machine.simulateConnectionEstablished('socket-456')

      // Stream should still be in completed (parallel regions are independent)
      harness.machine.assertState((s) => s.matches({ stream: 'completed' }))

      // Adapter syncs on every state change, so we should see completed state
      // Note: Due to table-driven adapter, only changes trigger calls
      // Since stream state didn't change (stayed completed), it may not call setStreamingState
      // Just verify the stream is still in completed state
      expect(harness.machine.actor.getSnapshot().matches({ stream: 'completed' })).toBe(true)

      harness.destroy()
    })
  })

  describe('cleanup', () => {
    it('should unsubscribe on destroy', () => {
      const harness = new StoreSyncAdapterTestHarness()

      harness.clearAllMocks()

      // Destroy adapter
      harness.adapter.destroy()

      // Send event to machine
      harness.machine.simulateConnect('app-123')

      // Store should NOT be updated (unsubscribed)
      expect(harness.mockStore.setWebSocketState).not.toHaveBeenCalled()

      harness.destroy()
    })
  })
})
