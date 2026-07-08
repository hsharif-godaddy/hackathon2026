import { EventSource } from 'eventsource'
import { STREAMING_EVENT_TYPES, type StreamingEventType } from '@airo/ai-transport/event-types'
import { REQUEST_IDP_TOKEN } from '@airo/shared/chat'

import { agentFetch, clearAgentTokenCache, getAgentToken } from '@/lib/agent-fetch'
import { pushIdpToken } from '@/lib/push-idp-token'
import { logger } from '@/lib/request-context'
import type { SSEQualityMonitor } from './SSEQualityMonitor'
import type { ChatTransport, ChatTransportCallbacks, SendMessageParams, TransportEvent, TransportState } from './types'

export const SSE_INTENTIONALLY_IGNORED: ReadonlySet<StreamingEventType> = new Set([
  'budget_status',
  'conversation_info',
  'catchup_status',
  'catchup_complete',
] as const)

/**
 * Events emitted by SSE routes but not part of the channel event type union.
 * `history_loaded` and `history_complete` are client-synthesized in loadHistory(),
 * not server-emitted over SSE. `history_message`, `stream_error`, and `oauth_result`
 * are emitted directly by the SSE route handler. `media_caption` is an out-of-band
 * app push fanned out by the agents `EventStreamRegistry` after async caption
 * generation (AIROBUILD-2680).
 */
export const ROUTE_EVENT_TYPES = [
  'history_message',
  'history_loaded',
  'history_complete',
  'stream_error',
  'oauth_result',
  'media_caption',
] as const

export const SSE_REGISTERED_EVENT_TYPES = [...STREAMING_EVENT_TYPES, ...ROUTE_EVENT_TYPES].filter(
  (t) => !SSE_INTENTIONALLY_IGNORED.has(t as StreamingEventType)
)

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface SSETransportConfig {
  baseUrl: string
  /**
   * Number of consecutive non-401 transport errors before entering cooldown.
   * Prevents the polyfill from hammering a down server indefinitely.
   */
  maxConsecutiveErrors?: number
  /**
   * Cooldown duration in ms after the error threshold is hit. During cooldown
   * the EventSource is closed (so the polyfill stops retrying) and reconnect
   * is gated. A user signal via reconnectIfNeeded() can short-circuit the
   * cooldown.
   */
  cooldownMs?: number
  /**
   * Optional client-quality monitor, created and owned by useSSEChat. The
   * transport feeds it stream-open and error-count timings; the hook feeds it
   * connect-phase and send/first-response timings. Absent in PaaS/headless use.
   */
  qualityMonitor?: SSEQualityMonitor
  /**
   * Number of quiet cooldown cycles allowed during an ACTIVE turn before the
   * transport gives up and surfaces a terminal error. Idle outages never use
   * this — they go dormant after the first streak. (AIROBUILD-2628)
   */
  maxActiveCooldowns?: number
}

export class SSETransport implements ChatTransport {
  private config: SSETransportConfig
  private eventSource: InstanceType<typeof EventSource> | null = null
  private callbacks: ChatTransportCallbacks | null = null
  private appId: string | null = null
  private token: string | null = null
  private conversationId: string | null = null
  private _state: TransportState = 'disconnected'
  // Guard against overlapping open() calls (e.g. from updateToken during an
  // in-flight open); the EventSource polyfill handles drop-driven reconnect
  // on its own, with Last-Event-Id preserved from `id:` lines.
  private reconnecting = false
  private eventSubscribers = new Map<string, Set<(data: any) => void>>()

  // Circuit-breaker state. The polyfill's own backoff is unbounded — once it
  // is in long backoff there is no client signal to "try again now". We
  // count consecutive non-401 onerror callbacks; on threshold we close the
  // EventSource and freeze for cooldownMs. reconnectIfNeeded() (called on
  // visibilitychange / focus) can break the freeze on user activity.
  private readonly maxConsecutiveErrors: number
  private readonly cooldownMs: number
  private consecutiveErrors = 0
  private firstStreamEventSeen = false
  private cooldownUntil = 0
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null
  private visibilityListener: (() => void) | null = null
  // Active-turn cooldown budget + the latched active/idle decision for the
  // current outage. activeCooldowns persists across cooldown-timer reopens
  // (so the ~5-min budget keeps counting) and is reset only by recovery
  // (replay_complete) or explicit intent. outageActive is latched on the first
  // error of a streak — see onerror.
  private readonly maxActiveCooldowns: number
  private activeCooldowns = 0
  private outageActive = false

  constructor(config: SSETransportConfig) {
    this.config = config
    this.maxConsecutiveErrors = config.maxConsecutiveErrors ?? 10
    this.cooldownMs = config.cooldownMs ?? 60_000
    this.maxActiveCooldowns = config.maxActiveCooldowns ?? 3
  }

  get state(): TransportState {
    return this._state
  }

  on(callbacks: ChatTransportCallbacks): void {
    this.callbacks = callbacks
  }

  connect(appId: string, token: string, conversationId?: string): void {
    this.appId = appId
    this.token = token
    this.conversationId = conversationId ?? null
    // Fresh session resets any prior cooldown — a connect() call is an
    // explicit user/app intent that should not be gated by stale failures.
    this.resetCooldown()
    this.resetReconnectState()
    this.attachVisibilityListener()
    this.openEventSource()
  }

  updateToken(token: string): void {
    this.token = token
    if (this.appId && (this.eventSource || this._state !== 'disconnected')) {
      this.closeEventSource()
      this.openEventSource()
    }
  }

  private prefetchIdpToken(): Promise<void> {
    if (!this.appId || !this.conversationId) return Promise.resolve()
    return pushIdpToken(this.appId, this.conversationId)
  }

  private async refreshTokenAndReopen(): Promise<void> {
    if (!this.appId) return
    try {
      clearAgentTokenCache(this.appId)
      const fresh = await getAgentToken(this.appId)
      this.token = fresh
      if (this.appId) this.openEventSource()
    } catch (err) {
      logger.error('sse.transport.auth_refresh.failed', {
        appId: this.appId, conversationId: this.conversationId, error: errMessage(err),
      })
      // Auth failure requires user action — stop the unbounded retry loop.
      // Active turn: bounded cooldown (gives the user time to re-auth and
      // recover the stream). Idle: dormant (no point retrying without user
      // action; re-armed by the next sendMessage).
      // Reading _state is safe here — no cooldown cycle has mutated it yet;
      // the 401 handler closed the EventSource synchronously before awaiting.
      if (this._state === 'streaming') {
        this.enterActiveCooldown()
      } else {
        this.enterDormant()
      }
      // enterActiveCooldown may call enterUnreachable (budget exhausted) which
      // already fires onError — avoid a double-fire.
      if (this._state !== 'error') {
        this.callbacks?.onError(err instanceof Error ? err : new Error('auth_refresh_failed'))
      }
    }
  }

  disconnect(): void {
    this.reconnecting = false
    this.resetCooldown()
    this.resetReconnectState()
    this.closeEventSource()
    // Detach the listener here so a focus / visibilitychange event after an
    // explicit disconnect cannot revive the connection via reconnectIfNeeded().
    // useSSEChat calls disconnect() in its connect-effect cleanup when the
    // hook's `enabled` flag flips to false; the transport instance lives on
    // until unmount, so without this any tab focus in that window would
    // silently re-open SSE. connect() re-attaches.
    this.detachVisibilityListener()
    this.setState('disconnected')
  }

  destroy(): void {
    this.disconnect()
    this.callbacks = null
    this.eventSubscribers.clear()
  }

  /**
   * On-demand reconnect. Call this when the user signals activity (tab
   * regains focus, visibility goes to "visible", a successful API call
   * implies the network is back). Behavior:
   *
   *   - Honors explicit disconnect: no-op if there are no live credentials.
   *   - In cooldown: short-circuits the freeze and reopens immediately. The
   *     user's signal is stronger evidence than the timer.
   *   - EventSource missing (closed without cooldown): reopens.
   *   - EventSource present: no-op. The polyfill is already retrying or
   *     connected; a second open from here would race the existing one.
   */
  reconnectIfNeeded(): void {
    if (!this.appId || !this.token || !this.conversationId) return
    // Defense-in-depth: even though disconnect() detaches the listener, a
    // caller could invoke reconnectIfNeeded() directly while we're in the
    // disconnected state. Honour the explicit disconnect rather than reviving.
    if (this._state === 'disconnected') return
    // Dormant is a deliberate idle give-up (AIROBUILD-2628): only an explicit
    // sendMessage() re-arms it. Tab focus / visibility must NOT revive it.
    if (this._state === 'dormant') return
    if (this.cooldownUntil > 0 && Date.now() < this.cooldownUntil) {
      this.resetCooldown('manual')
      this.resetReconnectState() // user signal grants a fresh active budget
      this.openEventSource()
      return
    }
    if (!this.eventSource) {
      this.openEventSource()
    }
  }

  // Active-turn outage: a turn was streaming when the connection dropped, so
  // keep trying (quietly) to avoid dropping completion events — recovery-replay
  // resumes the turn when the stream returns. Bounded to maxActiveCooldowns
  // cycles (~5 min at the defaults) before giving up.
  private enterActiveCooldown(): void {
    if (this.activeCooldowns >= this.maxActiveCooldowns) {
      this.enterUnreachable()
      return
    }
    this.activeCooldowns++
    this.cooldownUntil = Date.now() + this.cooldownMs
    // Quiet: do NOT fire onError and do NOT change _state — the turn is still
    // running server-side and its UI must stay intact across the wait.
    this.closeEventSource()
    logger.warn('sse.transport.cooldown.entered', {
      appId: this.appId, conversationId: this.conversationId,
      cooldownMs: this.cooldownMs, errors: this.consecutiveErrors,
      activeCooldowns: this.activeCooldowns,
    })
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null
      const hadCredentials = !!(this.appId && this.token && this.conversationId)
      this.resetCooldown('timer') // resets consecutiveErrors; KEEPS activeCooldowns
      if (hadCredentials) this.openEventSource()
    }, this.cooldownMs)
  }

  // Idle outage: no turn was active, so a live stream is only a convenience.
  // Stop retrying entirely and go dormant — re-armed only by the next
  // sendMessage(). This silences orphaned/idle tabs (AIROBUILD-2628).
  private enterDormant(): void {
    this.closeEventSource()
    this.resetReconnectState()
    this.setState('dormant')
    logger.warn('sse.transport.dormant', {
      appId: this.appId, conversationId: this.conversationId,
      errors: this.consecutiveErrors,
    })
  }

  // Active-turn give-up after the cooldown budget is exhausted. Surface a
  // terminal transport error so useSSEChat finalizes the stream and unsticks
  // the input; a subsequent send re-arms the stream.
  private enterUnreachable(): void {
    this.closeEventSource()
    this.resetReconnectState()
    this.setState('error')
    this.callbacks?.onError(new Error('sse_transport_unreachable'))
    logger.warn('sse.transport.unreachable', {
      appId: this.appId, conversationId: this.conversationId,
      activeCooldowns: this.activeCooldowns,
    })
  }

  // Full reset of the active/idle outage tracking. Distinct from
  // resetCooldown(): the active-cooldown timer must PRESERVE activeCooldowns so
  // the ~5-minute budget keeps counting across reopen cycles, whereas explicit
  // intent (connect / manual reconnect / disconnect) and a successful
  // replay_complete forget the outage entirely.
  private resetReconnectState(): void {
    this.activeCooldowns = 0
    this.outageActive = false
  }

  private resetCooldown(reason?: 'timer' | 'manual'): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer)
      this.cooldownTimer = null
    }
    if (reason && this.cooldownUntil > 0) {
      logger.info('sse.transport.cooldown.exit', {
        appId: this.appId, conversationId: this.conversationId, reason,
      })
    }
    this.cooldownUntil = 0
    this.consecutiveErrors = 0
  }

  private attachVisibilityListener(): void {
    if (typeof window === 'undefined') return
    if (this.visibilityListener) return
    const handler = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      this.reconnectIfNeeded()
    }
    this.visibilityListener = handler
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handler)
    }
    window.addEventListener('focus', handler)
  }

  private detachVisibilityListener(): void {
    if (typeof window === 'undefined') return
    if (!this.visibilityListener) return
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener)
    }
    window.removeEventListener('focus', this.visibilityListener)
    this.visibilityListener = null
  }

  private get convPath(): string {
    return `${this.config.baseUrl}/api/conversations/${this.appId}/${this.conversationId}`
  }

  private authedFetch(url: string, init?: RequestInit): Promise<Response> {
    // All HTTP helpers share the same auth path: agentFetch handles Bearer
    // injection, cache-bust on 401, and retry with a fresh token. Keeping a
    // single path here prevents the stale-refresher bug that arises when
    // callers cache their own refresher closure.
    if (!this.appId) throw new Error('Not connected')
    return agentFetch(url, { siteId: this.appId, ...init })
  }

  async sendMessage(params: SendMessageParams): Promise<void> {
    if (!this.appId || !this.conversationId) throw new Error('Not connected')

    // Re-arm a torn-down stream on user send. Any non-disconnected state with
    // no live EventSource lands here — idle dormancy, the active give-up, and a
    // failed auth refresh — because the POST's response events need a live
    // stream (recovery-replay handles ordering). An explicit disconnect()
    // (state 'disconnected') is honoured — not revived. (AIROBUILD-2628)
    if (!this.eventSource && this._state !== 'disconnected') {
      this.resetCooldown()
      this.resetReconnectState()
      this.openEventSource()
    }

    const response = await this.authedFetch(`${this.convPath}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: params.content,
        sessionId: params.sessionId,
        userTimezone: params.userTimezone,
        templateId: params.templateId,
        overrideAgentId: params.overrideAgentId,
        designKitSlug: params.designKitSlug,
        modelOverride: params.modelOverride,
        visualContext: params.visualContext,
        aiEditContext: params.aiEditContext,
        aiEditContexts: params.aiEditContexts,
        selectedAssets: params.selectedAssets,
        todoListContext: params.todoListContext,
        isActionRequest: params.isActionRequest,
        customContext: params.customContext,
        rebuildBuildPageSlug: params.rebuildBuildPageSlug,
        ...(params.rebuildDesignDirection && { rebuildDesignDirection: params.rebuildDesignDirection }),
        ...(params.rebuildBringOverChoice && { rebuildBringOverChoice: params.rebuildBringOverChoice }),
        budgetServiceEnabled: params.budgetServiceEnabled,
        subscriptionId: params.subscriptionId,
        buildErrorContext: params.buildErrorContext,
        uploadedFileName: params.uploadedFileName,
        automationId: params.automationId,
        market: params.market,
        fullStorySessionId: params.fullStorySessionId,
        ...(params.isEmbedded !== undefined && { isEmbedded: params.isEmbedded }),
      })
    })

    if (response.status === 402) {
      const body = await response.json().catch(() => ({ error: 'Budget exceeded' }))
      const err = new Error(body.error || 'Budget exceeded')
      ;(err as any).statusCode = 402
      ;(err as any).errorType = 'BUDGET_EXCEEDED'
      throw err
    }
    if (!response.ok) throw new Error(`Chat request failed: ${response.status}`)
    this.setState('streaming')
  }

  async postClientActionResult(data: {
    requestId: string
    success: boolean
    result?: unknown
    error?: string
    errorDetails?: string
    logs?: Array<{ message: string; source?: string; timestamp?: string }>
    exitCode?: number
  }): Promise<void> {
    if (!this.appId || !this.conversationId) {
      // Silent resolve would leave the agent blocked on a result that
      // never comes: the useSSEChat wrapper only attaches .catch, and a
      // resolved promise never fires it. Log + throw so the rejection
      // propagates and the blocked-agent case is visible end-to-end.
      logger.warn('sse.transport.post_action_result.no_session', {
        requestId: data.requestId, success: data.success,
        hasAppId: !!this.appId, hasConversationId: !!this.conversationId,
      })
      throw new Error('post_action_result.no_session')
    }
    const response = await this.authedFetch(`${this.convPath}/actions`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`postClientActionResult failed: ${response.status}`)
  }

  /**
   * Best-effort signal asking the agent to reset the timeout on a pending
   * client action (SSE reverse channel for context.resetActionTimeout).
   *
   * Unlike postClientActionResult, this is fire-and-forget: the agent is NOT
   * blocked on it, so a failure (including an older agent without this route →
   * 404) must NOT throw. It degrades to the agent keeping the action's
   * original timeout — exactly the pre-reset behavior. Failures are logged and
   * swallowed; the no-session case also returns quietly rather than throwing.
   */
  async requestClientActionTimeoutReset(data: {
    requestId: string
  }): Promise<void> {
    if (!this.appId || !this.conversationId) {
      logger.warn('sse.transport.reset_action_timeout.no_session', {
        requestId: data.requestId,
        hasAppId: !!this.appId,
        hasConversationId: !!this.conversationId,
      })
      return
    }
    const response = await this.authedFetch(`${this.convPath}/actions/reset-timeout`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    if (!response.ok) {
      logger.warn('sse.transport.reset_action_timeout.failed', {
        requestId: data.requestId,
        status: response.status,
      })
    }
  }

  async stopGeneration(): Promise<void> {
    if (!this.appId || !this.conversationId) {
      // The useSSEChat .catch only fires on rejection, so a silent resolve
      // hides "user clicked Stop but no request went out". Log so the
      // disconnected-stop case is diagnosable alongside HTTP failures.
      logger.warn('sse.transport.stop.no_session', {
        hasAppId: !!this.appId, hasConversationId: !!this.conversationId,
      })
      return
    }
    const response = await this.authedFetch(`${this.convPath}/stop`, {
      method: 'POST',
    })
    if (!response.ok) throw new Error(`stopGeneration failed: ${response.status}`)
  }

  loadHistory(params: { cursor?: string; limit?: number } = {}): void {
    if (!this.appId || !this.conversationId) return

    const qs = new URLSearchParams()
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.cursor) qs.set('before', params.cursor)
    const suffix = qs.toString() ? `?${qs}` : ''

    this.authedFetch(`${this.convPath}/messages${suffix}`)
      .then(res => {
        if (!res.ok) throw new Error(`History fetch failed: ${res.status}`)
        return res.json()
      })
      .then((result: { messages: unknown[]; hasMore: boolean; nextCursor: string | null; total: number }) => {
        for (const msg of result.messages) {
          this.callbacks?.onEvent({
            type: 'history_message',
            data: { data: msg, isPagination: !!params.cursor },
          })
        }
        this.callbacks?.onEvent({
          type: params.cursor ? 'history_complete' : 'history_loaded',
          data: {
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
            messageCount: result.messages.length,
          },
        })
      })
      .catch((err: unknown) => {
        const msg = errMessage(err)
        const isPagination = !!params.cursor
        logger.warn('sse.transport.load_history.failed', {
          appId: this.appId, conversationId: this.conversationId,
          isPagination, error: msg,
        })
        this.callbacks?.onEvent({
          type: isPagination ? 'history_complete' : 'history_loaded',
          data: {
            error: msg,
            hasMore: isPagination,
            nextCursor: isPagination ? (params.cursor ?? null) : null,
            messageCount: 0,
          },
        })
      })
  }

  emitGrantContext(payload: { grants: unknown[]; timestamp: number }): boolean {
    if (!this.conversationId || !this.appId) return false
    this.authedFetch(`${this.convPath}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ grants: payload.grants }),
    }).then(res => {
      if (!res.ok) {
        logger.warn('sse.transport.grant_context.http_error', {
          appId: this.appId, conversationId: this.conversationId, status: res.status,
        })
      }
    }).catch(err => {
      logger.warn('sse.transport.grant_context.failed', {
        appId: this.appId, conversationId: this.conversationId, error: errMessage(err),
      })
    })
    return true
  }

  onGrantRefreshRequested(callback: () => void): () => void {
    return this.subscribe('request_grant_refresh', callback)
  }

  onBudgetUpdate(callback: (data: any) => void): () => void {
    return this.subscribe('budget_update', callback)
  }


  private subscribe(eventType: string, callback: (data: any) => void): () => void {
    if (!this.eventSubscribers.has(eventType)) {
      this.eventSubscribers.set(eventType, new Set())
    }
    this.eventSubscribers.get(eventType)!.add(callback)
    return () => { this.eventSubscribers.get(eventType)?.delete(callback) }
  }

  private openEventSource(): void {
    if (this.reconnecting) return
    this.reconnecting = true

    this.closeEventSource()
    if (!this.appId || !this.token || !this.conversationId) {
      this.reconnecting = false
      return
    }

    const url = `${this.convPath}/stream`
    this.firstStreamEventSeen = false
    this.config.qualityMonitor?.markStreamOpenStart(url)
    const token = this.token
    let firstFetch = true
    this.eventSource = new EventSource(url, {
      fetch: (input: any, init: any) => {
        const headers: Record<string, string> = {
          ...init?.headers,
          Authorization: `Bearer ${token}`,
        }
        // On the first open of this EventSource, don't send Last-Event-Id:
        // the server reads its absence as "no in-memory deltas" and replays
        // the full buffer so an in-progress turn can be reconstructed.
        // Polyfill auto-reconnects inject their tracked cursor on later
        // fetches, which triggers delta replay.
        if (firstFetch) {
          delete headers['Last-Event-ID']
          delete headers['last-event-id']
        }
        firstFetch = false
        return fetch(input, { ...init, headers })
      },
    })

    this.eventSource.onerror = (err: any) => {
      if (err?.code === 401 || err?.status === 401) {
        // 401 is an auth event, not a transport fault — refresh the token and
        // reopen without bumping the circuit-breaker counter.
        this.closeEventSource()
        void this.refreshTokenAndReopen()
        return
      }
      this.consecutiveErrors++
      // Feed the quality monitor every error (in-memory metric, not a log line,
      // so it does not flood ESSP).
      this.config.qualityMonitor?.recordEventSourceError(this.consecutiveErrors)
      // Latch active-vs-idle at the START of a failure streak. _state changes
      // across cooldown cycles, so reading it at the threshold is unsafe; the
      // latch protects the turn that was live when the drop began. Log only the
      // first error of a streak — attempts 2..N are suppressed so an orphaned
      // tab does not flood ESSP (AIROBUILD-2628, AC3).
      if (this.consecutiveErrors === 1) {
        this.outageActive = this._state === 'streaming'
        logger.warn('sse.transport.eventsource.error', {
          appId: this.appId, conversationId: this.conversationId,
          status: err?.status, code: err?.code,
          message: err?.message ?? errMessage(err),
          outageActive: this.outageActive,
        })
      }
      if (this.consecutiveErrors >= this.maxConsecutiveErrors && this.cooldownUntil === 0) {
        if (this.outageActive) {
          this.enterActiveCooldown()
        } else {
          this.enterDormant()
        }
      }
    }

    this.eventSource.addEventListener(REQUEST_IDP_TOKEN, () => {
      void this.prefetchIdpToken()
    })

    for (const type of SSE_REGISTERED_EVENT_TYPES) {
      this.eventSource.addEventListener(type, (event: MessageEvent) => {
        this.handleTypedEvent(type, event)
      })
    }

    queueMicrotask(() => { this.reconnecting = false })
  }

  private closeEventSource(): void {
    this.eventSource?.close()
    this.eventSource = null
  }

  private handleTypedEvent(type: string, event: MessageEvent): void {
    // Native EventSource connection failures also dispatch an "error" event,
    // but that is not an SSE MessageEvent and has no JSON payload. Let onerror
    // handle transport faults; this path is only for server-sent events.
    if (typeof event.data !== 'string') {
      return
    }

    // First SSE event of any type = stream is alive. Placed after the
    // non-string guard so native EventSource error events do not count.
    this.noteFirstStreamEvent()

    let data: Record<string, unknown>
    try {
      data = JSON.parse(event.data)
    } catch (err) {
      // Systematic server-side serialization bugs would otherwise make the
      // stream look healthy while every event silently disappears.
      logger.warn('sse.transport.event.parse_failed', {
        appId: this.appId, conversationId: this.conversationId,
        eventType: type, error: errMessage(err),
      })
      return
    }

    // oauth_result and debug_turn_stats are out-of-band app events, not
    // conversation events — short-circuit before eventSubscribers / onEvent
    // so they never flow through the conversation channel. TransportSupervisor
    // dispatches the same CustomEvents for the WS path.
    if (type === 'oauth_result') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('oauth:result', { detail: data }))
      }
      return
    }

    if (type === 'debug_turn_stats') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('airo:debug-turn-stats', { detail: data }))
      }
      return
    }

    const subscribers = this.eventSubscribers.get(type)
    if (subscribers?.size) {
      for (const cb of subscribers) cb(data)
    }

    const parsedSequence = parseInt((event as MessageEvent).lastEventId ?? '', 10)
    const transportEvent: TransportEvent = {
      type,
      data,
      content: data.content as string | undefined,
      conversationId: data.conversationId as string | undefined,
      sequence: Number.isFinite(parsedSequence) ? parsedSequence : undefined,
    }

    if (type === 'replay_complete') {
      this.consecutiveErrors = 0
      this.config.qualityMonitor?.resetErrorBuckets()
      this.resetReconnectState()
      this.setState('connected')
    } else if (type === 'complete') {
      this.setState('connected')
    } else if (type === 'error' || type === 'stream_error') {
      this.setState('connected')
    }

    this.callbacks?.onEvent(transportEvent)
  }


  private noteFirstStreamEvent(): void {
    if (this.firstStreamEventSeen) return
    this.firstStreamEventSeen = true
    this.config.qualityMonitor?.markFirstStreamEvent()
  }

  private setState(state: TransportState): void {
    if (this._state !== state) {
      this._state = state
      this.callbacks?.onStateChange(state)
    }
  }
}
