import { EventSource } from 'eventsource'

import { agentFetch, clearAgentTokenCache, getAgentToken } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import type { ChatTransport, ChatTransportCallbacks, SendMessageParams, TransportEvent, TransportState } from './types'

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface SSETransportConfig {
  baseUrl: string
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

  constructor(config: SSETransportConfig) {
    this.config = config
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
    this.closeEventSource()
    this.setState('disconnected')
  }

  destroy(): void {
    this.disconnect()
    this.callbacks = null
    this.eventSubscribers.clear()
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
        templateId: params.templateId,
        modelOverride: params.modelOverride,
        agentProfile: params.agentProfile,
        visualContext: params.visualContext,
        aiEditContext: params.aiEditContext,
        selectedAssets: params.selectedAssets,
        todoListContext: params.todoListContext,
        isActionRequest: params.isActionRequest,
        customContext: params.customContext,
        budgetServiceEnabled: params.budgetServiceEnabled,
        subscriptionId: params.subscriptionId,
        buildErrorContext: params.buildErrorContext,
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
        logger.warn('sse.transport.load_history.failed', {
          appId: this.appId, conversationId: this.conversationId,
          isPagination: !!params.cursor, error: msg,
        })
        this.callbacks?.onEvent({
          type: params.cursor ? 'history_complete' : 'history_loaded',
          data: { error: msg, hasMore: false, nextCursor: null, messageCount: 0 },
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
        this.closeEventSource()
        void this.refreshTokenAndReopen()
        return
      }
      // Non-401 errors: let the polyfill reconnect on its own. It preserves
      // Last-Event-Id from prior `id:` lines and applies exponential backoff.
      // Log so intermittent transport faults are visible in dev.log instead
      // of being silently swallowed.
      logger.warn('sse.transport.eventsource.error', {
        appId: this.appId, conversationId: this.conversationId,
        status: err?.status, code: err?.code,
        message: err?.message ?? errMessage(err),
      })
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
      'budget_update',
      'history_message', 'history_loaded', 'history_complete',
      'recovery_status', 'replay_complete', 'catchup_status', 'catchup_complete',
      'client_action', 'video', 'status', 'request_grant_refresh', 'resync',
      'auth_expired',
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

    // oauth_result is an out-of-band app event, not a conversation event —
    // short-circuit before eventSubscribers / onEvent so it never flows
    // through the conversation channel. TransportSupervisor dispatches the
    // same CustomEvent for the WS path.
    if (type === 'oauth_result') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('oauth:result', { detail: data }))
      }
      return
    }

    const subscribers = this.eventSubscribers.get(type)
    if (subscribers?.size) {
      for (const cb of subscribers) cb(data)
    }

    const transportEvent: TransportEvent = {
      type,
      data,
      content: data.content as string | undefined,
      conversationId: data.conversationId as string | undefined,
    }

    if (type === 'complete') {
      this.setState('connected')
    } else if (type === 'error' || type === 'stream_error') {
      this.setState('connected')
    } else if (type === 'auth_expired') {
      this.callbacks?.onError(new Error('auth_expired'))
      return
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
