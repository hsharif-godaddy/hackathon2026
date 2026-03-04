/**
 * NetworkQualityMonitor
 *
 * Event-triggered network quality reporting for WebSocket connections.
 * Logs warnings when quality thresholds are exceeded — no UI, no store changes,
 * no periodic polling. Warnings are automatically shipped to the server in
 * production via the existing ClientLogBuffer (which ships warn+ level logs).
 *
 * Fits entirely in the Tier 2 data layer — no state machine changes.
 */

import type { Socket } from 'socket.io-client'

import { logger } from '@/lib/request-context'
import type { ConnectionPhases } from './ConnectionManager'

// Thresholds
export const PING_LATENCY_WARN_MS = 500
export const MESSAGE_RTT_WARN_MS = 5000
export const CONNECT_DURATION_WARN_MS = 10_000
export const RECOVERY_DURATION_WARN_MS = 30_000
export const RETRY_COUNT_WARN_THRESHOLD = 3

export class NetworkQualityMonitor {
  private connectStartedAt: number | null = null
  private appId: string | null = null
  private lastWarnedRetryCount = 0
  private phases: ConnectionPhases | null = null

  // Engine event listeners (stored for cleanup)
  private pingSentAt: number | null = null
  private onPing: (() => void) | null = null
  private onPong: (() => void) | null = null
  private attachedEngine: any = null

  /**
   * Attach to a connected socket's engine to monitor ping/pong latency.
   * Must be called after connection is established (engine is available).
   */
  attachToSocket(socket: Socket, appId: string): void {
    this.appId = appId
    const engine = (socket as any).io?.engine
    if (!engine) return

    this.detachFromSocket(socket)

    this.attachedEngine = engine

    this.onPing = () => {
      this.pingSentAt = Date.now()
    }

    this.onPong = () => {
      if (this.pingSentAt === null) return
      const latencyMs = Date.now() - this.pingSentAt
      this.pingSentAt = null

      if (latencyMs > PING_LATENCY_WARN_MS) {
        logger.warn('websocket.quality.high_ping_latency', {
          latencyMs,
          appId: this.appId,
          socketId: socket.id,
          threshold: PING_LATENCY_WARN_MS,
        })
      }
    }

    engine.on('ping', this.onPing)
    engine.on('pong', this.onPong)
  }

  /**
   * Remove engine listeners from a socket.
   */
  detachFromSocket(_socket: Socket): void {
    if (this.attachedEngine) {
      if (this.onPing) this.attachedEngine.off('ping', this.onPing)
      if (this.onPong) this.attachedEngine.off('pong', this.onPong)
    }
    this.onPing = null
    this.onPong = null
    this.pingSentAt = null
    this.attachedEngine = null
  }

  /**
   * Record timestamp when connection attempt starts.
   * Accepts appId so connect-duration warnings include it (called before attachToSocket).
   */
  markConnectStart(appId: string): void {
    this.appId = appId
    this.connectStartedAt = Date.now()
  }

  /**
   * Accept phase-level timing data from ConnectionManager.
   * Called via the onConnectionPhases callback after socket connects.
   */
  setConnectionPhases(phases: ConnectionPhases): void {
    this.phases = phases
  }

  /**
   * Log if connection took longer than threshold.
   * When phases are available, include full breakdown in the warning payload.
   */
  markConnectEstablished(socketId: string): void {
    if (this.connectStartedAt === null) return
    const durationMs = Date.now() - this.connectStartedAt
    this.connectStartedAt = null

    if (durationMs > CONNECT_DURATION_WARN_MS) {
      logger.warn('websocket.quality.slow_connect', {
        durationMs,
        appId: this.appId,
        socketId,
        threshold: CONNECT_DURATION_WARN_MS,
        // Include phase breakdown when available — this is the key diagnostic data
        ...(this.phases && {
          connectAttemptId: this.phases.connectAttemptId,
          configFetchMs: this.phases.configFetchMs,
          tokenFetchMs: this.phases.tokenFetchMs,
          preSocketMs: this.phases.preSocketMs,
          socketHandshakeMs: this.phases.socketHandshakeMs,
          tokenResourceTiming: this.phases.tokenResourceTiming,
          wsResourceTiming: this.phases.wsResourceTiming,
        }),
      })
    }

    this.phases = null
  }

  /**
   * Record timestamp when a message is sent. Returns the timestamp for RTT calculation.
   */
  markMessageSent(): number {
    return Date.now()
  }

  /**
   * Log if message ack RTT exceeds threshold.
   */
  markMessageAcked(sentAt: number, socketId: string): void {
    const rttMs = Date.now() - sentAt
    if (rttMs > MESSAGE_RTT_WARN_MS) {
      logger.warn('websocket.quality.slow_message_rtt', {
        rttMs,
        appId: this.appId,
        socketId,
        threshold: MESSAGE_RTT_WARN_MS,
      })
    }
  }

  /**
   * Log if recovery took longer than threshold.
   */
  logRecoveryDuration(durationMs: number, socketId: string): void {
    if (durationMs > RECOVERY_DURATION_WARN_MS) {
      logger.warn('websocket.quality.slow_recovery', {
        durationMs,
        appId: this.appId,
        socketId,
        threshold: RECOVERY_DURATION_WARN_MS,
      })
    }
  }

  /**
   * Log if retry count crosses a threshold multiple.
   * Warns at every multiple of RETRY_COUNT_WARN_THRESHOLD (3, 6, 9, ...) to avoid spam.
   */
  logRetryCount(retryCount: number, socketId: string): void {
    if (retryCount < RETRY_COUNT_WARN_THRESHOLD) return

    // Only warn at threshold crossings (multiples of threshold)
    const currentBucket = Math.floor(retryCount / RETRY_COUNT_WARN_THRESHOLD)
    const lastBucket = Math.floor(this.lastWarnedRetryCount / RETRY_COUNT_WARN_THRESHOLD)

    if (currentBucket > lastBucket) {
      this.lastWarnedRetryCount = retryCount
      logger.warn('websocket.quality.excessive_retries', {
        retryCount,
        appId: this.appId,
        socketId,
        threshold: RETRY_COUNT_WARN_THRESHOLD,
      })
    }
  }

  /**
   * Clean up all state and listeners.
   */
  destroy(): void {
    if (this.attachedEngine) {
      if (this.onPing) this.attachedEngine.off('ping', this.onPing)
      if (this.onPong) this.attachedEngine.off('pong', this.onPong)
    }
    this.onPing = null
    this.onPong = null
    this.pingSentAt = null
    this.attachedEngine = null
    this.connectStartedAt = null
    this.appId = null
    this.lastWarnedRetryCount = 0
    this.phases = null
  }
}
