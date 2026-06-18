/**
 * SSEQualityMonitor
 *
 * Client-side connection/latency instrumentation for the SSE chat transport,
 * mirroring NetworkQualityMonitor on the WebSocket path. Per-connect and
 * per-send timings ship via shipAnalyticsLog('funnel.sse.*') (always to ESSP);
 * threshold breaches ship via logger.warn('sse.transport.quality.*').
 *
 * Owned by useSSEChat (which feeds connect-phase + send/first-response timings,
 * after its replay/stale guards) and injected into SSETransport (which feeds
 * stream-open + error-count timings). See
 * docs/observability/sse-client-instrumentation.md.
 */

import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'

export const CONNECT_DURATION_WARN_MS = 10_000
export const FIRST_RESPONSE_WARN_MS = 5_000
export const ERROR_BUCKET_WARN_THRESHOLD = 3

export type ConversationSource = 'cookie' | 'created'

export interface SSEConnectPhases {
  configFetchMs: number
  tokenFetchMs: number
  /** Present only when the conversation was created via POST (absent for cookie source). */
  conversationCreateMs?: number
  conversationSource: ConversationSource
}

interface TokenResourceTiming {
  serverProcessingMs: number
  transferMs: number
  totalFetchMs: number
  connectionReused: boolean
}

interface StreamResourceTiming {
  dnsMs: number
  tcpMs: number
  tlsMs: number
  ttfbMs: number
}

export class SSEQualityMonitor {
  private appId: string | null = null
  private connectStartedAt: number | null = null
  private pendingPhases: SSEConnectPhases | null = null
  private streamOpenStartedAt: number | null = null
  private streamUrl: string | null = null
  private sendStartedAt: number | null = null
  private lastWarnedErrorCount = 0
  private onVisibilityChange: (() => void) | null = null

  constructor() {
    if (typeof document !== 'undefined') {
      this.onVisibilityChange = () => {
        if (document.visibilityState !== 'hidden') return
        // Invalidate in-flight connect + send timers: a backgrounded tab
        // produces extreme outliers that are not representative of health.
        this.connectStartedAt = null
        this.pendingPhases = null
        this.streamOpenStartedAt = null
        this.streamUrl = null
        this.sendStartedAt = null
      }
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    }
  }

  private isHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  }

  /** Marks the start of the connect funnel (top of the hook's connect()). */
  markConnectStart(appId: string): void {
    this.appId = appId
    if (this.isHidden()) {
      this.connectStartedAt = null
      return
    }
    this.connectStartedAt = Date.now()
  }

  /** Records phase timings produced by the hook, just before transport.connect(). */
  recordConnectPhases(phases: SSEConnectPhases): void {
    this.pendingPhases = phases
  }

  /** Called by SSETransport in openEventSource. streamUrl enables stream resource timing. */
  markStreamOpenStart(streamUrl?: string): void {
    this.streamUrl = streamUrl ?? null
    if (this.isHidden()) {
      this.streamOpenStartedAt = null
      return
    }
    this.streamOpenStartedAt = Date.now()
  }

  /**
   * Called by SSETransport on the first dispatched SSE event of any type.
   * Emits the connect funnel exactly once (when the hook recorded phases for an
   * initial connect); reconnect-only stream opens re-time streamOpenMs silently.
   */
  markFirstStreamEvent(): void {
    if (this.streamOpenStartedAt === null) return
    const now = Date.now()
    const streamOpenMs = now - this.streamOpenStartedAt
    this.streamOpenStartedAt = null

    if (!this.pendingPhases || this.connectStartedAt === null) {
      this.streamUrl = null
      return
    }

    const totalMs = now - this.connectStartedAt
    const phases = this.pendingPhases
    const resourceEntries =
      typeof performance !== 'undefined'
        ? (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        : []
    const tokenResourceTiming = this.getTokenResourceTiming(resourceEntries)
    const streamResourceTiming = this.getStreamResourceTiming(resourceEntries)

    shipAnalyticsLog('funnel.sse.connected', {
      appId: this.appId,
      configFetchMs: phases.configFetchMs,
      tokenFetchMs: phases.tokenFetchMs,
      ...(phases.conversationCreateMs !== undefined && { conversationCreateMs: phases.conversationCreateMs }),
      conversationSource: phases.conversationSource,
      streamOpenMs,
      totalMs,
      ...(tokenResourceTiming && { tokenResourceTiming }),
      ...(streamResourceTiming && { streamResourceTiming }),
    })

    if (totalMs > CONNECT_DURATION_WARN_MS) {
      logger.warn('sse.transport.quality.slow_connect', {
        appId: this.appId,
        totalMs,
        streamOpenMs,
        configFetchMs: phases.configFetchMs,
        tokenFetchMs: phases.tokenFetchMs,
        ...(phases.conversationCreateMs !== undefined && { conversationCreateMs: phases.conversationCreateMs }),
        conversationSource: phases.conversationSource,
        threshold: CONNECT_DURATION_WARN_MS,
      })
    }

    this.pendingPhases = null
    this.connectStartedAt = null
    this.streamUrl = null
  }

  /** Called by the hook in sendMessage, immediately before the POST. */
  markSend(): void {
    if (this.isHidden()) {
      this.sendStartedAt = null
      return
    }
    this.sendStartedAt = Date.now()
  }

  /**
   * Called by the hook from onEvent for the first STREAM_UPDATE_EVENTS event,
   * AFTER replay-dedup and stale-stream_retry guards. No-op when no send is
   * pending (buffered/recovery replay bursts arrive with no pending send).
   */
  markFirstResponse(): void {
    if (this.sendStartedAt === null) return
    const firstResponseMs = Date.now() - this.sendStartedAt
    this.sendStartedAt = null

    shipAnalyticsLog('funnel.sse.first_response', {
      appId: this.appId,
      firstResponseMs,
    })

    if (firstResponseMs > FIRST_RESPONSE_WARN_MS) {
      logger.warn('sse.transport.quality.slow_first_response', {
        appId: this.appId,
        firstResponseMs,
        threshold: FIRST_RESPONSE_WARN_MS,
      })
    }
  }

  /** Clears the pending-send timer on terminal paths (POST failure, complete, error, disconnect, stop). */
  clearSend(): void {
    this.sendStartedAt = null
  }

  /**
   * Called by SSETransport on each non-401 onerror. `count` is the transport's
   * consecutiveErrors. Warns only at bucket crossings (3/6/9) to avoid storms.
   */
  recordEventSourceError(count: number): void {
    if (count < ERROR_BUCKET_WARN_THRESHOLD) return
    const currentBucket = Math.floor(count / ERROR_BUCKET_WARN_THRESHOLD)
    const lastBucket = Math.floor(this.lastWarnedErrorCount / ERROR_BUCKET_WARN_THRESHOLD)
    if (currentBucket > lastBucket) {
      this.lastWarnedErrorCount = count
      logger.warn('sse.transport.quality.excessive_errors', {
        appId: this.appId,
        consecutiveErrors: count,
        threshold: ERROR_BUCKET_WARN_THRESHOLD,
      })
    }
  }

  /** Called by SSETransport on a successful `initialize` (transport healthy again). */
  resetErrorBuckets(): void {
    this.lastWarnedErrorCount = 0
  }

  destroy(): void {
    this.appId = null
    this.connectStartedAt = null
    this.pendingPhases = null
    this.streamOpenStartedAt = null
    this.streamUrl = null
    this.sendStartedAt = null
    this.lastWarnedErrorCount = 0
    if (this.onVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
    }
    this.onVisibilityChange = null
  }

  /**
   * Same-origin agent-token fetch timing (no Timing-Allow-Origin needed).
   * Mirrors ConnectionManager.getTokenResourceTiming. Best-effort.
   */
  private getTokenResourceTiming(entries: PerformanceResourceTiming[]): TokenResourceTiming | null {
    const entry = entries.filter((e) => e.name.includes('/api/auth/agent-token')).pop()
    if (!entry) return null
    return {
      serverProcessingMs: Math.round(entry.responseStart - entry.requestStart),
      transferMs: Math.round(entry.responseEnd - entry.responseStart),
      totalFetchMs: Math.round(entry.responseEnd - entry.startTime),
      connectionReused: entry.connectEnd - entry.connectStart === 0,
    }
  }

  /**
   * Cross-origin /stream GET timing. Detailed breakdown requires
   * Timing-Allow-Origin from the agents server; degrades to null otherwise.
   */
  private getStreamResourceTiming(entries: PerformanceResourceTiming[]): StreamResourceTiming | null {
    if (!this.streamUrl) return null
    try {
      const targetPath = new URL(this.streamUrl).pathname
      const entry = entries.filter((e) => e.name.includes(targetPath)).pop()
      if (!entry) return null
      return {
        dnsMs: Math.round(entry.domainLookupEnd - entry.domainLookupStart),
        tcpMs: Math.round(
          entry.secureConnectionStart > 0
            ? entry.secureConnectionStart - entry.connectStart
            : entry.connectEnd - entry.connectStart,
        ),
        tlsMs: Math.round(entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0),
        ttfbMs: Math.round(entry.responseStart - entry.requestStart),
      }
    } catch {
      return null
    }
  }
}
