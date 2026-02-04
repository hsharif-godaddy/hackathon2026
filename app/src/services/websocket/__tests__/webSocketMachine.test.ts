/**
 * WebSocket State Machine Tests
 *
 * Comprehensive tests for the XState WebSocket machine.
 * Tests all state transitions, guards, actions, and parallel states.
 */

import { afterEach, beforeEach, describe, it, vi } from 'vitest'

import { StateMachineTestHarness } from './StateMachineTestUtils'
import { MAX_RETRY_COUNT, MAX_RETRY_DELAY_MS, webSocketMachine } from '../webSocketMachine'

describe('webSocketMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('transport lifecycle', () => {
    it('should start in disconnected state', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.assertState((s) =>
        s.matches({ transport: 'disconnected', stream: 'completed' })
      )

      harness.destroy()
    })

    it('should transition from disconnected → connecting → connected', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.assertState((s) =>
        s.matches({ transport: { connecting: 'fetchingToken' } })
      )
      harness.assertContext((ctx) => ctx.appId === 'app-123')

      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.assertState((s) =>
        s.matches({ transport: { connecting: 'establishingConnection' } })
      )

      harness.simulateConnectionEstablished('socket-456')
      harness.assertState((s) =>
        s.matches({ transport: { connected: 'idle' } })
      )
      harness.assertContext((ctx) => ctx.socketId === 'socket-456')
      harness.assertContext((ctx) => ctx.retryCount === 0)

      harness.destroy()
    })

    it('should handle connection failure with retry', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.actor.send({
        type: 'CONNECTION_FAILED',
        error: new Error('Network error'),
      })

      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )
      harness.assertContext((ctx) => ctx.retryCount === 1)
      harness.assertContext((ctx) => ctx.retryDelayMs === 1000) // 500 * 2

      // Wait for retry delay
      await vi.advanceTimersByTimeAsync(1000)

      harness.assertState((s) =>
        s.matches({ transport: { connecting: 'fetchingToken' } })
      )

      harness.destroy()
    })

    it('should exhaust retries after max attempts', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Fail connection MAX_RETRY_COUNT times to exhaust retries
      for (let i = 0; i < MAX_RETRY_COUNT; i++) {
        harness.actor.send({ type: 'CONNECT', appId: 'app-123' })
        harness.actor.send({ type: 'TOKEN_REFRESHED' })
        harness.actor.send({
          type: 'CONNECTION_FAILED',
          error: new Error('Connection failed'),
        })

        // Advance through retry delay
        if (i < MAX_RETRY_COUNT - 1) {
          const delay = Math.min(500 * Math.pow(2, i + 1), MAX_RETRY_DELAY_MS)
          await vi.advanceTimersByTimeAsync(delay)
        }
      }

      // Should be in exhausted state
      harness.assertContext((ctx) => ctx.retryCount === MAX_RETRY_COUNT)

      // Advance final timer
      await vi.advanceTimersByTimeAsync(MAX_RETRY_DELAY_MS)

      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'exhausted' } })
      )

      harness.destroy()
    })

    it('should handle token refresh failure', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.actor.send({
        type: 'TOKEN_REFRESH_FAILED',
        error: new Error('Token expired'),
      })

      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )
      harness.assertContext((ctx) => ctx.lastError !== null)

      harness.destroy()
    })
  })

  describe('streaming lifecycle', () => {
    it('should handle streaming flow', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection first
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')

      // Start stream
      harness.actor.send({
        type: 'SEND_MESSAGE',
        message: { content: 'Hello' },
        conversationId: 'conv-789',
      })
      harness.assertState((s) => s.matches({ stream: { streaming: 'receiving' } }))
      harness.assertContext((ctx) => ctx.conversationId === 'conv-789')

      // Complete stream
      harness.simulateStreamComplete()
      harness.assertState((s) => s.matches({ stream: { streaming: 'completing' } }))

      // Wait for completion delay
      await vi.advanceTimersByTimeAsync(100)
      harness.assertState((s) => s.matches({ stream: 'completed' }))

      harness.destroy()
    })

    it('should handle stream error (non-retryable)', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection and streaming
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({
        type: 'SEND_MESSAGE',
        message: {},
        conversationId: 'conv-789',
      })

      // Simulate non-retryable error
      harness.simulateStreamError(new Error('Budget exceeded'), false)

      harness.assertState((s) => s.matches({ stream: 'error' }))
      harness.assertContext((ctx) => ctx.lastError !== null)

      harness.destroy()
    })

    it('should handle stream error (retryable)', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection and streaming
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({
        type: 'SEND_MESSAGE',
        message: {},
        conversationId: 'conv-789',
      })

      // Simulate retryable error
      harness.simulateStreamError(new Error('Transient error'), true)

      // Should stay in receiving state for retryable errors
      harness.assertState((s) => s.matches({ stream: { streaming: 'receiving' } }))
      harness.assertContext((ctx) => ctx.lastError !== null)

      harness.destroy()
    })

    it('should allow new stream after completion', () => {
      const harness = new StateMachineTestHarness(webSocketMachine, {
        conversationId: 'conv-1',
        messageId: 'msg-1',
      })

      // Start in completed state
      harness.actor.send({ type: 'STREAM_COMPLETE' })
      // @ts-expect-error - accessing internal state for testing
      harness.actor._actorScope.sessionId // eslint-disable-line @typescript-eslint/no-unused-expressions

      // Send new message
      harness.actor.send({
        type: 'SEND_MESSAGE',
        message: {},
        conversationId: 'conv-2',
      })

      harness.assertState((s) => s.matches({ stream: { streaming: 'receiving' } }))
      harness.assertContext((ctx) => ctx.conversationId === 'conv-2')

      harness.destroy()
    })
  })

  describe('recovery flow', () => {
    it('should handle recovery with ACK tracking', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')

      // Start recovery
      harness.simulateRecoveryFlow('recovery-123', 3)
      harness.assertState((s) =>
        s.matches({ transport: { connected: { recovering: 'pendingAck' } } })
      )
      harness.assertContext((ctx) => ctx.expectedReplayEvents === 3)
      harness.assertContext((ctx) => ctx.recoveryId === 'recovery-123')

      // Track replay events
      harness.simulateReplayEvent()
      harness.assertContext((ctx) => ctx.receivedReplayEvents === 1)

      harness.simulateReplayEvent()
      harness.assertContext((ctx) => ctx.receivedReplayEvents === 2)

      harness.simulateReplayEvent()
      harness.assertContext((ctx) => ctx.receivedReplayEvents === 3)

      // Should auto-transition to sendingAck
      await vi.advanceTimersByTimeAsync(0) // Allow state update
      harness.assertState((s) =>
        s.matches({ transport: { connected: { recovering: 'sendingAck' } } })
      )

      // Send ACK
      harness.simulateRecoveryAckSent()
      harness.assertState((s) => s.matches({ transport: { connected: 'idle' } }))
      harness.assertContext((ctx) => ctx.recoveryId === null)

      harness.destroy()
    })

    it('should auto-transition on replay complete flag', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection and recovery
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')
      harness.simulateRecoveryFlow('recovery-123', 5)

      // Mark replay complete (even if not all events received)
      harness.simulateReplayComplete()

      await vi.advanceTimersByTimeAsync(0)
      harness.assertState((s) =>
        s.matches({ transport: { connected: { recovering: 'sendingAck' } } })
      )

      harness.destroy()
    })

    it('should timeout recovery after 30 seconds', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection and recovery
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')
      harness.simulateRecoveryFlow('recovery-123', 100)

      // Wait for timeout
      await vi.advanceTimersByTimeAsync(30000)

      harness.assertState((s) =>
        s.matches({ transport: { connected: { recovering: 'sendingAck' } } })
      )

      harness.destroy()
    })

    it('should handle catchup flow', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection and recovery
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')
      harness.simulateRecoveryFlow('recovery-123', 3)

      // Transition to catchup
      harness.simulateCatchupStatus('catchup-456')
      harness.assertState((s) =>
        s.matches({ transport: { connected: { recovering: 'catchup' } } })
      )
      harness.assertContext((ctx) => ctx.catchupId === 'catchup-456')

      // Complete catchup
      harness.simulateCatchupComplete()
      harness.assertState((s) => s.matches({ transport: { connected: 'idle' } }))
      harness.assertContext((ctx) => ctx.catchupId === null)

      harness.destroy()
    })
  })

  describe('parallel states', () => {
    it('should handle disconnect during streaming', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection + streaming
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({
        type: 'SEND_MESSAGE',
        message: {},
        conversationId: 'conv-789',
      })

      // Verify parallel states
      harness.assertState((s) =>
        s.matches({
          transport: { connected: 'idle' },
          stream: { streaming: 'receiving' },
        })
      )

      // Disconnect during stream
      harness.simulateDisconnect('Connection lost')

      // Transport should reconnect, stream state persists
      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )
      // Stream continues in receiving state
      harness.assertState((s) => s.matches({ stream: { streaming: 'receiving' } }))

      harness.destroy()
    })

    it('should maintain stream state during reconnection', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup streaming
      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({
        type: 'SEND_MESSAGE',
        message: {},
        conversationId: 'conv-789',
      })

      const conversationId = harness.getContext().conversationId

      // Disconnect
      harness.simulateDisconnect('Connection lost')

      // Reconnect
      await vi.advanceTimersByTimeAsync(1000)
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-new')

      // Verify context preserved
      harness.assertContext((ctx) => ctx.conversationId === conversationId)

      harness.destroy()
    })
  })

  describe('context updates', () => {
    it('should update server config', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.actor.send({ type: 'TOKEN_REFRESHED' })
      harness.simulateConnectionEstablished('socket-456')

      const config = {
        streamRecoveryWindow: 30000,
        ackTimeout: 5000,
      }

      harness.actor.send({
        type: 'SERVER_CONFIG_RECEIVED',
        config,
      })

      harness.assertContext((ctx) => ctx.serverConfig !== null)
      harness.assertContext((ctx) => ctx.serverConfig?.streamRecoveryWindow === 30000)

      harness.destroy()
    })

    it('should track pending message on disconnect', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      const message = { content: 'Hello' }

      harness.actor.send({
        type: 'SEND_MESSAGE',
        message,
        conversationId: 'conv-123',
      })

      harness.assertContext((ctx) => ctx.pendingMessage === message)

      harness.destroy()
    })

    it('should clear error on successful connection', () => {
      const harness = new StateMachineTestHarness(webSocketMachine, {
        lastError: new Error('Previous error'),
      })

      harness.simulateConnect('app-123')
      harness.assertContext((ctx) => ctx.lastError === null)

      harness.destroy()
    })
  })

  describe('guards', () => {
    it('should allow retry when under max count', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Fail connection a few times
      for (let i = 0; i < 5; i++) {
        harness.actor.send({ type: 'CONNECT', appId: 'app-123' })
        harness.actor.send({ type: 'TOKEN_REFRESHED' })
        harness.actor.send({
          type: 'CONNECTION_FAILED',
          error: new Error('Connection failed'),
        })

        const delay = Math.min(500 * Math.pow(2, i + 1), MAX_RETRY_DELAY_MS)
        await vi.advanceTimersByTimeAsync(delay)
      }

      // Should have retried and be under max count
      harness.assertContext((ctx) => ctx.retryCount === 5)
      harness.assertContext((ctx) => ctx.retryCount < MAX_RETRY_COUNT)

      harness.destroy()
    })

    it('should prevent retry when max count exceeded', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Fail connection MAX_RETRY_COUNT times to reach max
      for (let i = 0; i < MAX_RETRY_COUNT; i++) {
        harness.actor.send({ type: 'CONNECT', appId: 'app-123' })
        harness.actor.send({ type: 'TOKEN_REFRESHED' })
        harness.actor.send({
          type: 'CONNECTION_FAILED',
          error: new Error('Connection failed'),
        })

        if (i < MAX_RETRY_COUNT - 1) {
          const delay = Math.min(500 * Math.pow(2, i + 1), MAX_RETRY_DELAY_MS)
          await vi.advanceTimersByTimeAsync(delay)
        }
      }

      // Should be at max
      harness.assertContext((ctx) => ctx.retryCount === MAX_RETRY_COUNT)

      // Advance final timer - should go to exhausted
      await vi.advanceTimersByTimeAsync(MAX_RETRY_DELAY_MS)

      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'exhausted' } })
      )

      harness.destroy()
    })
  })
})
