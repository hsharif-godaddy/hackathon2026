import { EventSource } from 'eventsource'

import { agentFetch, clearAgentTokenCache, getAgentToken } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import type { ChatTransport, ChatTransportCallbacks, SendMessageParams, TransportEvent, TransportState } from './types'

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
  private cooldownUntil = 0
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null
  private visibilityListener: (() => void) | null = null

  constructor(config: SSETransportConfig) {
    this.config = config
    this.maxConsecutiveErrors = config.maxConsecutiveErrors ?? 10
    this.cooldownMs = config.cooldownMs ?? 60_000
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
      this.setState('error')
      this.callbacks?.onError(err instanceof Error ? err : new Error('auth_refresh_failed'))
    }
  }

  disconnect(): void {
    this.reconnecting = false
    this.resetCooldown()
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
    if (this.cooldownUntil > 0 && Date.now() < this.cooldownUntil) {
      this.resetCooldown('manual')
      this.openEventSource()
      return
    }
    if (!this.eventSource) {
      this.openEventSource()
    }
  }

  private enterCooldown(): void {
    this.cooldownUntil = Date.now() + this.cooldownMs
    // Stop the polyfill from continuing to hammer while we wait. It will be
    // reopened either by the cooldown timer or by reconnectIfNeeded().
    this.closeEventSource()
    this.setState('error')
    this.callbacks?.onError(new Error('sse_transport_cooldown'))
    logger.warn('sse.transport.cooldown.entered', {
      appId: this.appId, conversationId: this.conversationId,
      cooldownMs: this.cooldownMs, errors: this.consecutiveErrors,
    })
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null
      // Auto-reopen if credentials still live; the user did not have to
      // touch the tab for the freeze to end.
      const hadCredentials = !!(this.appId && this.token && this.conversationId)
      this.resetCooldown('timer')
      if (hadCredentials) this.openEventSource()
    }, this.cooldownMs)
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

    const response = await this.authedFetch(`${this.convPath}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: params.content,
        sessionId: params.sessionId,
        userTimezone: params.userTimezone,
        templateId: params.templateId,
        modelOverride: params.modelOverride,
        agentProfile: params.agentProfile,
        visualContext: params.visualContext,
        aiEditContext: params.aiEditContext,
        aiEditContexts: params.aiEditContexts,
        selectedAssets: params.selectedAssets,
        todoListContext: params.todoListContext,
        isActionRequest: params.isActionRequest,
        customContext: params.customContext,
        budgetServiceEnabled: params.budgetServiceEnabled,
        subscriptionId: params.subscriptionId,
        buildErrorContext: params.buildErrorContext,
        uploadedFileName: params.uploadedFileName,
        market: params.market,
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
        // Close before refresh so the polyfill does not auto-reconnect with
        // the stale token (producing a retry storm) while we wait for the
        // cache to clear and a fresh token to be issued.
        // 401 is an auth event, not a transport fault — don't bump the
        // circuit-breaker counter or it would trip on a single token rotation.
        this.closeEventSource()
        void this.refreshTokenAndReopen()
        return
      }
      this.consecutiveErrors++
      // Non-401 errors: let the polyfill reconnect on its own until the
      // threshold trips. After that we close it and freeze for cooldownMs.
      logger.warn('sse.transport.eventsource.error', {
        appId: this.appId, conversationId: this.conversationId,
        status: err?.status, code: err?.code,
        message: err?.message ?? errMessage(err),
        consecutiveErrors: this.consecutiveErrors,
      })
      if (this.consecutiveErrors >= this.maxConsecutiveErrors && this.cooldownUntil === 0) {
        this.enterCooldown()
      }
    }

    this.eventSource.addEventListener('initialize', (e: MessageEvent) => {
      let data: any
      try {
        data = JSON.parse(e.data)
      } catch (err) {
        logger.warn('sse.transport.initialize.parse_failed', {
          appId: this.appId, conversationId: this.conversationId, error: errMessage(err),
        })
        this.setState('error')
        this.callbacks?.onError(new Error('initialize_parse_failed'))
        return
      }
      // Successful initialize = transport is healthy again. Clear the
      // circuit-breaker counter so a fresh streak of failures has to occur
      // before we'd cool down again.
      this.consecutiveErrors = 0
      this.setState('connected')

      if (data.serverConfig) {
        this.callbacks?.onEvent({ type: 'server_config', data: data.serverConfig })
      }
      if (data.agents?.length) {
        this.callbacks?.onEvent({ type: 'agents_available', data: { agents: data.agents } })
      }
    })

    const eventTypes = [
      'chunk', 'tool_start', 'tool_input_delta', 'tool_call', 'tool_result',
      'step_start', 'step_complete', 'complete', 'error', 'stream_error',
      'budget_update', 'debug_turn_stats', 'stream_retry',
      'validation_message',
      'history_message', 'history_loaded', 'history_complete',
      'recovery_status', 'replay_complete', 'catchup_status', 'catchup_complete',
      'client_action', 'video', 'status', 'request_grant_refresh', 'resync',
      'oauth_result',
    ]

    for (const type of eventTypes) {
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

    if (type === 'complete') {
      this.setState('connected')
    } else if (type === 'error' || type === 'stream_error') {
      this.setState('connected')
    }

    this.callbacks?.onEvent(transportEvent)
  }


  private setState(state: TransportState): void {
    if (this._state !== state) {
      this._state = state
      this.callbacks?.onStateChange(state)
    }
  }
}
