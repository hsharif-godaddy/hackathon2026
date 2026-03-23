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

    it('should transition from disconnected → connecting → authenticating → connected', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.assertState((s) =>
        s.matches({ transport: 'connecting' })
      )
      harness.assertContext((ctx) => ctx.appId === 'app-123')

      harness.simulateConnectionEstablished('socket-456')
      harness.assertState((s) =>
        s.matches({ transport: 'authenticating' })
      )

      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
      harness.assertState((s) =>
        s.matches({ transport: { connected: 'idle' } })
      )
      harness.assertContext((ctx) => ctx.socketId === 'socket-456')
      harness.assertContext((ctx) => ctx.retryCount === 0)

      harness.destroy()
    })

    it('should handle DISCONNECT during connecting state', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.assertState((s) => s.matches({ transport: 'connecting' }))

      // Disconnect while connecting (e.g., socket closed before handshake)
      harness.actor.send({
        type: 'DISCONNECT',
        reason: 'transport close',
      })

      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )

      harness.destroy()
    })

    it('should handle DISCONNECT during authenticating state', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.assertState((s) => s.matches({ transport: 'authenticating' }))

      // Disconnect while authenticating
      harness.actor.send({
        type: 'DISCONNECT',
        reason: 'transport close',
      })

      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )

      harness.destroy()
    })

    it('should handle auth failure with retry', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({
        type: 'AUTH_FAILED',
        error: new Error('Auth error'),
      })

      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )
      harness.assertContext((ctx) => ctx.retryCount === 1)
      harness.assertContext((ctx) => ctx.retryDelayMs === 1000) // 500 * 2

      // Wait for retry delay
      await vi.advanceTimersByTimeAsync(1000)

      harness.assertState((s) =>
        s.matches({ transport: 'connecting' })
      )

      harness.destroy()
    })

    it('should exhaust retries after max attempts', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Fail auth MAX_RETRY_COUNT times to exhaust retries
      for (let i = 0; i < MAX_RETRY_COUNT; i++) {
        harness.actor.send({ type: 'CONNECT', appId: 'app-123' })
        harness.simulateConnectionEstablished('socket-456')
        harness.actor.send({
          type: 'AUTH_FAILED',
          error: new Error('Auth failed'),
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

    it('should handle auth failure', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({
        type: 'AUTH_FAILED',
        error: new Error('Auth failed'),
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
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })

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
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
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
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
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
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })

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
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
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
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
      harness.simulateRecoveryFlow('recovery-123', 100)

      // Wait for timeout
      await vi.advanceTimersByTimeAsync(30000)

      harness.assertState((s) =>
        s.matches({ transport: { connected: { recovering: 'sendingAck' } } })
      )

      harness.destroy()
    })

    it('should clear stale recovery context when reconnecting back to idle', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection and start recovery
      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
      harness.simulateRecoveryFlow('recovery-123', 5)
      harness.assertState((s) =>
        s.matches({ transport: { connected: { recovering: 'pendingAck' } } })
      )
      harness.assertContext((ctx) => ctx.recoveryId === 'recovery-123')

      // Disconnect during recovery
      harness.simulateDisconnect('transport close')
      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )

      // Reconnect successfully
      await vi.advanceTimersByTimeAsync(1000)
      harness.simulateConnectionEstablished('socket-789')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-789' })
      harness.assertState((s) =>
        s.matches({ transport: { connected: 'idle' } })
      )

      // Recovery context should be cleared
      harness.assertContext((ctx) => ctx.recoveryId === null)
      harness.assertContext((ctx) => ctx.expectedReplayEvents === 0)
      harness.assertContext((ctx) => ctx.receivedReplayEvents === 0)

      harness.destroy()
    })

    it('should handle catchup flow', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection and recovery
      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
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

  describe('reconnecting accepts Socket.IO auto-reconnect events', () => {
    it('should handle CONNECTION_ESTABLISHED while in reconnecting.retrying', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })

      harness.simulateDisconnect('transport close')
      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )

      // Socket.IO auto-reconnects before RETRY_DELAY expires
      harness.simulateConnectionEstablished('socket-789')
      harness.assertState((s) =>
        s.matches({ transport: 'authenticating' })
      )
      harness.assertContext((ctx) => ctx.socketId === 'socket-789')

      harness.destroy()
    })

    it('should handle AUTH_SUCCESS while in reconnecting.retrying', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })

      harness.simulateDisconnect('transport close')
      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )

      // Socket.IO auto-reconnects and auth completes before RETRY_DELAY
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-789' })
      harness.assertState((s) =>
        s.matches({ transport: { connected: 'idle' } })
      )
      harness.assertContext((ctx) => ctx.socketId === 'socket-789')
      harness.assertContext((ctx) => ctx.retryCount === 0)

      harness.destroy()
    })

    it('should accept SERVER_CONFIG_RECEIVED while in reconnecting.retrying', function serverConfigDuringReconnecting() {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })

      harness.simulateDisconnect('transport close')
      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )

      harness.actor.send({
        type: 'SERVER_CONFIG_RECEIVED',
        config: { streamRecoveryWindow: 60000, ackTimeout: 10000 },
      })

      harness.assertContext((ctx) => ctx.serverConfig?.ackTimeout === 10000)
      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )

      harness.destroy()
    })

    it('should handle CONNECTION_ESTABLISHED at higher retry counts', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')

      // Build up retryCount to 3 via CONNECTION_FAILED — AUTH_SUCCESS is deliberately
      // avoided here because it calls resetRetry and would reset the delay back to 500ms.
      harness.actor.send({ type: 'CONNECTION_FAILED', error: new Error('timeout') })
      harness.assertContext((ctx) => ctx.retryCount === 1 && ctx.retryDelayMs === 1000)
      await vi.advanceTimersByTimeAsync(1000) // RETRY_DELAY fires → connecting

      harness.actor.send({ type: 'CONNECTION_FAILED', error: new Error('timeout') })
      harness.assertContext((ctx) => ctx.retryCount === 2 && ctx.retryDelayMs === 2000)
      await vi.advanceTimersByTimeAsync(2000) // RETRY_DELAY fires → connecting

      harness.actor.send({ type: 'CONNECTION_FAILED', error: new Error('timeout') })
      harness.assertContext((ctx) => ctx.retryCount === 3 && ctx.retryDelayMs === 4000)

      // Machine is waiting out the 4000ms delay — socket connects before it fires
      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )

      // Socket.IO reconnects at 2-5s, which may beat the 4s+ machine delay
      harness.simulateConnectionEstablished('socket-final')
      harness.assertState((s) =>
        s.matches({ transport: 'authenticating' })
      )

      harness.destroy()
    })
  })

  describe('parallel states', () => {
    it('should handle disconnect during streaming', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Setup connection + streaming
      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
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
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
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
      harness.simulateConnectionEstablished('socket-new')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-new' })

      // Verify context preserved
      harness.assertContext((ctx) => ctx.conversationId === conversationId)

      harness.destroy()
    })
  })

  describe('context updates', () => {
    it('should update server config', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })

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

    it('should accept SERVER_CONFIG_RECEIVED during authenticating', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.assertState((s) => s.matches({ transport: 'authenticating' }))

      const config = {
        streamRecoveryWindow: 60000,
        ackTimeout: 10000,
      }

      harness.actor.send({ type: 'SERVER_CONFIG_RECEIVED', config })
      harness.assertContext((ctx) => ctx.serverConfig?.streamRecoveryWindow === 60000)
      harness.assertState((s) => s.matches({ transport: 'authenticating' }))

      harness.destroy()
    })

    it('should accept SERVER_CONFIG_RECEIVED during connecting', () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.assertState((s) => s.matches({ transport: 'connecting' }))

      const config = {
        streamRecoveryWindow: 60000,
        ackTimeout: 10000,
      }

      harness.actor.send({ type: 'SERVER_CONFIG_RECEIVED', config })
      harness.assertContext((ctx) => ctx.serverConfig?.streamRecoveryWindow === 60000)

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

  describe('auth timeout defense-in-depth', () => {
    it('should transition from authenticating to reconnecting after AUTH_TIMEOUT (35s)', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.assertState((s) => s.matches({ transport: 'authenticating' }))

      // Advance just under 35s — should still be authenticating
      await vi.advanceTimersByTimeAsync(34_999)
      harness.assertState((s) => s.matches({ transport: 'authenticating' }))

      // Cross the 35s boundary
      await vi.advanceTimersByTimeAsync(1)
      harness.assertState((s) =>
        s.matches({ transport: { reconnecting: 'retrying' } })
      )
      harness.assertContext((ctx) => ctx.retryCount === 1)

      harness.destroy()
    })

    it('should NOT trigger AUTH_TIMEOUT if AUTH_SUCCESS arrives before 35s', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      harness.simulateConnect('app-123')
      harness.simulateConnectionEstablished('socket-456')
      harness.assertState((s) => s.matches({ transport: 'authenticating' }))

      // Auth succeeds at 10s — well before 35s timeout
      await vi.advanceTimersByTimeAsync(10_000)
      harness.actor.send({ type: 'AUTH_SUCCESS', socketId: 'socket-456' })
      harness.assertState((s) =>
        s.matches({ transport: { connected: 'idle' } })
      )

      // Advance past 35s — should remain connected (timeout cancelled)
      await vi.advanceTimersByTimeAsync(30_000)
      harness.assertState((s) =>
        s.matches({ transport: { connected: 'idle' } })
      )

      harness.destroy()
    })
  })

  describe('guards', () => {
    it('should allow retry when under max count', async () => {
      const harness = new StateMachineTestHarness(webSocketMachine)

      // Fail auth a few times
      for (let i = 0; i < 5; i++) {
        harness.actor.send({ type: 'CONNECT', appId: 'app-123' })
        harness.simulateConnectionEstablished('socket-456')
        harness.actor.send({
          type: 'AUTH_FAILED',
          error: new Error('Auth failed'),
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

      // Fail auth MAX_RETRY_COUNT times to reach max
      for (let i = 0; i < MAX_RETRY_COUNT; i++) {
        harness.actor.send({ type: 'CONNECT', appId: 'app-123' })
        harness.simulateConnectionEstablished('socket-456')
        harness.actor.send({
          type: 'AUTH_FAILED',
          error: new Error('Auth failed'),
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
