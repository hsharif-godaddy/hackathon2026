/**
 * Store Sync Adapter
 *
 * Maps XState machine transitions → Zustand store updates.
 * This is the ONLY place that calls lifecycle-related Zustand actions.
 *
 * Architecture:
 * - Subscribes to machine state changes
 * - Subscribes to controller/supervisor events for application-level state
 * - Maps machine states to store actions (table-driven, declarative)
 * - Centralizes all store updates in one place
 *
 * Note: Transcript data (tools, steps, chunks) bypass this adapter for performance
 * and are handled directly by message handlers (Tier 2).
 */

import type { EventEmitter } from 'events'
import type { Actor } from 'xstate'

import { logger } from '@/lib/request-context'
import type {
  RecoveryState,
  RetryState,
  WebSocketState,
} from '@/stores/useStreamingConversationStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { WebSocketMachine, WebSocketSnapshot } from './webSocketMachine'

/**
 * Store interface expected by the adapter
 * Only includes lifecycle-related actions (Tier 1)
 */
export interface StoreSyncStore {
  setWebSocketState: (state: Partial<WebSocketState>) => void
  startStream: (conversationId: string, messageId: string) => void
  finalizeStream: () => void
  setError: (error: Error) => void
  setRecoveryState: (state: RecoveryState) => void
  setRetryState: (state: RetryState) => void
  setStreamingState: (state: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error') => void
  setIsLoading: (loading: boolean) => void
  markUpstreamError: (error: { message: string; type?: string }) => void
}

/**
 * Application-level store actions (outside machine state)
 * These handle connection retry tracking and escalation timeouts
 */
export interface ApplicationStore extends StoreSyncStore {
  startConnectionRetry: (socketId: string) => void
  clearConnectionRetry: () => void
  setEscalationTimeout: (timeoutId: NodeJS.Timeout) => void
  connectionRetry: {
    isRetrying: boolean
    retryStartedAt: number | null
  }
  activeStream: unknown
}

/**
 * Controller interface for event subscriptions
 */
interface ControllerLike extends EventEmitter {
  on(event: 'transport:retry-started', listener: (data: { socketId: string }) => void): this
  on(event: 'transport:retry-cleared', listener: () => void): this
  on(event: 'transport:escalation-timeout', listener: (data: { socketId: string }) => void): this
  on(event: 'connection:established', listener: (data: { socket: any; recovered: boolean }) => void): this
  on(event: 'reconnect:success', listener: () => void): this
  on(event: 'reconnect:failed', listener: () => void): this
  on(event: 'stream:error', listener: (data: { error: Error; shouldFinalize: boolean }) => void): this
}

/**
 * Table-driven state mappings
 * Maps machine state patterns to WebSocketState updates
 */
const TRANSPORT_STATE_MAP: Record<string, Partial<WebSocketState>> = {
  'transport.disconnected': { status: 'idle', connected: false },
  'transport.connecting.fetchingToken': { status: 'connecting', connected: false },
  'transport.connecting.establishingConnection': { status: 'connecting', connected: false },
  'transport.connected.idle': { status: 'idle', connected: true },
  // Recovery is still "connected" at the transport layer. Recovery state is reflected via recoveryState.
  'transport.connected.recovering.pendingAck': { status: 'idle', connected: true },
  'transport.connected.recovering.sendingAck': { status: 'idle', connected: true },
  'transport.connected.recovering.catchup': { status: 'idle', connected: true },
  // Reconnecting is explicitly NOT connected at the transport layer.
  'transport.reconnecting.retrying': { status: 'connecting', connected: false },
  'transport.reconnecting.exhausted': { status: 'error', connected: false },
  'transport.failed': { status: 'error', connected: false },
}

/**
 * Additional store updates to apply on specific state transitions
 * Used for resetting ephemeral state that should not persist across disconnections
 */
const TRANSPORT_STATE_RESETS: Record<string, () => void> = {
  'transport.disconnected': () => {
    // Reset server capabilities on disconnect to force re-detection on reconnect
    useStreamingConversationStore.setState({ serverCapabilities: null })
  }
}

/**
 * Store Sync Adapter
 *
 * Synchronizes XState machine state to Zustand store
 * Subscribes to controller events for application-level state management
 */
export class StoreSyncAdapter {
  private machineSubscription: { unsubscribe: () => void } | null = null
  private previousStreamState: string | null = null
  private escalationTimeoutId: NodeJS.Timeout | null = null

  constructor(
    private machine: Actor<WebSocketMachine>,
    private controller: ControllerLike,
    private getStore: () => StoreSyncStore & Partial<ApplicationStore>
  ) {
    // Subscribe to all machine state transitions
    this.machineSubscription = this.machine.subscribe((snapshot) => {
      this.syncToStore(snapshot)
    })

    // Subscribe to controller/supervisor events for application-level state
    this.setupControllerEventHandlers()

    // Do initial sync via microtask to avoid setState-during-render warnings
    // This ensures store updates happen after the current render phase completes
    // Using Promise.resolve() ensures compatibility with test frameworks' fake timers
    Promise.resolve().then(() => {
      this.syncToStore(this.machine.getSnapshot())
    })
  }

  /**
   * Get current store state (always gets latest)
   */
  private get store(): StoreSyncStore & Partial<ApplicationStore> {
    return this.getStore()
  }

  private setupControllerEventHandlers(): void {
    // Connection retry tracking
    this.controller.on('transport:retry-started', ({ socketId }) => {
      if (this.store.startConnectionRetry) {
        this.store.startConnectionRetry(socketId)
      }
    })

    this.controller.on('connection:established', ({ socket }) => {
      // Keep store `websocket.connected` in sync with actual transport connectivity.
      //
      // In development, React StrictMode and appId transitions can temporarily stop the XState actor
      // during an in-flight connection attempt. When that happens, machine transitions can be dropped,
      // leaving the store stuck at `connected=false` even though Socket.IO is connected.
      //
      // Downstream: the create-flow auto-send waits on `webSocketState.connected` before sending the
      // initial prompt, so failing to flip this flag can stall the entire chat panel.
      const storeState = useStreamingConversationStore.getState()
      const isAlreadyConnected = storeState.websocket?.connected === true
      if (!isAlreadyConnected) {
        this.store.setWebSocketState({ connected: true, status: 'idle' })
      }

      // Clear connection retry tracking if active
      if (this.store.clearConnectionRetry && this.store.connectionRetry?.isRetrying) {
        const snapshot = this.machine.getSnapshot()
        logger.info('websocket.connect.clearing-stale-retry', {
          socketId: socket.id,
          elapsedMs: this.store.connectionRetry.retryStartedAt
            ? Date.now() - this.store.connectionRetry.retryStartedAt
            : null,
        })

        // Check if stream is in streaming state
        if (snapshot.matches({ stream: { streaming: 'receiving' } })) {
          logger.info('websocket.stream.recovered-on-connect', { socketId: socket.id })
        }

        this.store.clearConnectionRetry()
      }
    })

    this.controller.on('reconnect:success', () => {
      // Clear connection retry on successful reconnection
      if (this.store.clearConnectionRetry && this.store.connectionRetry?.isRetrying) {
        const snapshot = this.machine.getSnapshot()
        logger.info('websocket.reconnect.resuming-stream', {
          elapsedMs: this.store.connectionRetry.retryStartedAt
            ? Date.now() - this.store.connectionRetry.retryStartedAt
            : null,
        })

        // Check if stream is in streaming state
        if (snapshot.matches({ stream: { streaming: 'receiving' } })) {
          logger.info('websocket.stream.recovered')
        }

        this.store.clearConnectionRetry()
      }
    })

    this.controller.on('transport:escalation-timeout', ({ socketId }) => {
      // Escalation timeout fired - fail the stream
      if (this.store.connectionRetry?.isRetrying) {
        logger.warn('websocket.escalation.timeout-fired', {
          socketId,
          elapsedMs: this.store.connectionRetry.retryStartedAt
            ? Date.now() - this.store.connectionRetry.retryStartedAt
            : null,
        })

        if (this.store.activeStream) {
          this.store.markUpstreamError({
            message: 'Connection lost - retry timeout exceeded',
            type: 'NETWORK_ERROR',
          })
          this.store.finalizeStream()
        }

        // Send STREAM_ERROR to machine
        this.machine.send({
          type: 'STREAM_ERROR',
          error: new Error('Connection lost - retry timeout exceeded'),
          retryable: false,
        })

        if (this.store.clearConnectionRetry) {
          this.store.clearConnectionRetry()
        }
      }
    })

    this.controller.on('reconnect:failed', () => {
      // Reconnection exhausted - clean up and finalize stream if needed
      if (this.store.clearConnectionRetry && this.store.connectionRetry?.isRetrying) {
        this.store.clearConnectionRetry()
      }

      // Check if we need to finalize stream
      const snapshot = this.machine.getSnapshot()
      const isStreaming =
        snapshot.matches({ stream: { streaming: 'receiving' } }) ||
        snapshot.matches({ stream: { streaming: 'completing' } })

      if (isStreaming && this.store.activeStream) {
        this.store.markUpstreamError({
          message: 'Failed to reconnect after multiple attempts',
          type: 'NETWORK_ERROR',
        })
        this.store.finalizeStream()

        // Send STREAM_ERROR to machine
        this.machine.send({
          type: 'STREAM_ERROR',
          error: new Error('Failed to reconnect after multiple attempts'),
          retryable: false,
        })
      }
    })

    this.controller.on('stream:error', ({ error, shouldFinalize }) => {
      this.store.markUpstreamError({
        message: error.message,
        type: 'STREAM_ERROR',
      })
      if (shouldFinalize) {
        this.store.finalizeStream()
      }
    })
  }

  private syncToStore(snapshot: WebSocketSnapshot): void {
    const { context } = snapshot
    const activeAppId = useStreamingConversationStore.getState().currentAppId

    // Guard against stale controllers updating the global store after app switching.
    // During app creation/redirects, multiple controllers can overlap briefly; without
    // this check, a disconnect from the previous app can clobber `websocket.connected`
    // for the current app and prevent initial prompt auto-send.
    if (context.appId && activeAppId && context.appId !== activeAppId) {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('websocket.adapter.sync.ignored_stale_app', {
          contextAppId: context.appId,
          activeAppId,
          transportState: this.getTransportStateKey(snapshot),
          streamState: this.getStreamState(snapshot),
        })
      }
      return
    }

    // Track stream state to detect transitions
    const currentStreamState = this.getStreamState(snapshot)
    const streamStateChanged = currentStreamState !== this.previousStreamState
    this.previousStreamState = currentStreamState

    // Log state transitions in development
    if (process.env.NODE_ENV === 'development') {
      logger.debug('websocket.adapter.sync', {
        streamState: currentStreamState,
        context: {
          appId: context.appId,
          socketId: context.socketId,
          conversationId: context.conversationId,
          recoveryId: context.recoveryId,
          retryCount: context.retryCount,
        },
      })
    }

    // ============ TABLE-DRIVEN TRANSPORT STATE MAPPING ============
    const transportKey = this.getTransportStateKey(snapshot)
    if (transportKey && TRANSPORT_STATE_MAP[transportKey]) {
      this.store.setWebSocketState(TRANSPORT_STATE_MAP[transportKey])

      // Apply additional state resets if defined for this transport state
      if (TRANSPORT_STATE_RESETS[transportKey]) {
        TRANSPORT_STATE_RESETS[transportKey]()
      }
    }

    // ============ RECOVERY STATE MAPPING ============
    if (this.isInRecovery(snapshot)) {
      this.store.setRecoveryState({
        isRecovering: true,
        expectedEvents: context.expectedReplayEvents,
        receivedEvents: context.receivedReplayEvents,
      })
    } else if (snapshot.matches({ transport: { connected: 'idle' } }) && context.recoveryId === null) {
      // Clear recovery state when back to idle
      this.store.setRecoveryState({
        isRecovering: false,
        expectedEvents: 0,
        receivedEvents: 0,
      })
    }

    // ============ RETRY STATE MAPPING ============
    if (snapshot.matches({ transport: { reconnecting: 'retrying' } })) {
      this.store.setRetryState({
        isRetrying: true,
        retryCount: context.retryCount,
        nextRetryMs: context.retryDelayMs,
      })
    } else if (snapshot.matches({ transport: { reconnecting: 'exhausted' } })) {
      this.store.setRetryState({
        isRetrying: false,
        retryCount: context.retryCount,
        exhausted: true,
      })
    } else if (snapshot.matches({ transport: { connected: 'idle' } }) && context.retryCount === 0) {
      this.store.setRetryState({
        isRetrying: false,
        retryCount: 0,
      })
    }

    // ============ STREAM STATE MAPPING ============
    this.syncStreamState(snapshot, currentStreamState, streamStateChanged, context)

    // ============ ERROR HANDLING ============
    if (
      snapshot.matches({ transport: 'failed' }) ||
      snapshot.matches({ transport: { reconnecting: 'exhausted' } })
    ) {
      if (context.lastError) {
        this.store.setError(context.lastError)
      }
      this.store.setWebSocketState({
        status: 'error',
        connected: false,
      })
    }
  }

  /**
   * Sync stream state (entry actions on state transitions)
   */
  private syncStreamState(
    snapshot: WebSocketSnapshot,
    currentStreamState: string,
    streamStateChanged: boolean,
    context: any
  ): void {
    // Entry to streaming.receiving - start stream
    if (snapshot.matches({ stream: { streaming: 'receiving' } })) {
      if (streamStateChanged && currentStreamState === 'streaming.receiving') {
        this.store.setIsLoading(true)

        if (context.conversationId && context.messageId) {
          this.store.startStream(context.conversationId, context.messageId)
        } else {
          this.store.setStreamingState('streaming')
        }
      }

      // Sync error even for retryable errors
      if (context.lastError) {
        this.store.setError(context.lastError)
      }
    }

    // Completing state
    if (snapshot.matches({ stream: { streaming: 'completing' } })) {
      this.store.setStreamingState('completing')
    }

    // Entry to completed - finalize
    if (snapshot.matches({ stream: 'completed' }) && streamStateChanged) {
      this.store.setStreamingState('idle')
      this.store.setIsLoading(false)
    }

    // Entry to error - set error
    if (snapshot.matches({ stream: 'error' }) && streamStateChanged) {
      if (context.lastError) {
        this.store.setError(context.lastError)
      }
      this.store.setStreamingState('error')
      this.store.setIsLoading(false)
    }

  }

  /**
   * Get transport state key for table lookup
   */
  private getTransportStateKey(snapshot: WebSocketSnapshot): string | null {
    if (snapshot.matches({ transport: 'disconnected' })) return 'transport.disconnected'
    if (snapshot.matches({ transport: { connecting: 'fetchingToken' } })) return 'transport.connecting.fetchingToken'
    if (snapshot.matches({ transport: { connecting: 'establishingConnection' } })) return 'transport.connecting.establishingConnection'
    if (snapshot.matches({ transport: { connected: 'idle' } })) return 'transport.connected.idle'
    if (snapshot.matches({ transport: { connected: { recovering: 'pendingAck' } } })) {
      return 'transport.connected.recovering.pendingAck'
    }
    if (snapshot.matches({ transport: { connected: { recovering: 'sendingAck' } } })) {
      return 'transport.connected.recovering.sendingAck'
    }
    if (snapshot.matches({ transport: { connected: { recovering: 'catchup' } } })) {
      return 'transport.connected.recovering.catchup'
    }
    if (snapshot.matches({ transport: { reconnecting: 'retrying' } })) return 'transport.reconnecting.retrying'
    if (snapshot.matches({ transport: { reconnecting: 'exhausted' } })) return 'transport.reconnecting.exhausted'
    if (snapshot.matches({ transport: 'failed' })) return 'transport.failed'
    return null
  }

  /**
   * Check if snapshot is in any recovery state
   */
  private isInRecovery(snapshot: WebSocketSnapshot): boolean {
    return (
      snapshot.matches({ transport: { connected: { recovering: 'pendingAck' } } }) ||
      snapshot.matches({ transport: { connected: { recovering: 'sendingAck' } } }) ||
      snapshot.matches({ transport: { connected: { recovering: 'catchup' } } })
    )
  }

  /**
   * Get current stream state as a string for transition detection
   */
  private getStreamState(snapshot: WebSocketSnapshot): string {
    if (snapshot.matches({ stream: { streaming: 'receiving' } })) return 'streaming.receiving'
    if (snapshot.matches({ stream: { streaming: 'completing' } })) return 'streaming.completing'
    if (snapshot.matches({ stream: 'completed' })) return 'completed'
    if (snapshot.matches({ stream: 'error' })) return 'error'
    return 'unknown'
  }

  /**
   * Cleanup - unsubscribe from machine and clear timeouts
   */
  destroy(): void {
    if (this.machineSubscription) {
      this.machineSubscription.unsubscribe()
      this.machineSubscription = null
    }

    if (this.escalationTimeoutId) {
      clearTimeout(this.escalationTimeoutId)
      this.escalationTimeoutId = null
    }
  }
}
