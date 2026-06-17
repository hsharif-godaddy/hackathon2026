/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/request-context'
import { SSETransport } from '../SSETransport'
import type { ChatTransportCallbacks } from '../types'

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(function (url: string, init: any) {
    const { siteId: _siteId, ...rest } = init ?? {}
    return fetch(url, {
      ...rest,
      headers: {
        Authorization: 'Bearer token_123',
        'Content-Type': 'application/json',
        ...(rest?.headers ?? {}),
      },
    })
  }),
  getAgentToken: vi.fn().mockResolvedValue('token_123'),
  clearAgentTokenCache: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let eventListeners: Record<string, Array<(e: MessageEvent) => void>> = {}
let lastEventSourceOptions: any = null
let lastEventSourceInstance: any = null
let eventSourceInstances: any[] = []
let autoFireInitialize = true

vi.mock('eventsource', () => ({
  EventSource: vi.fn().mockImplementation(function (url: string, options: any) {
    lastEventSourceOptions = options
    const instance = {
      url,
      readyState: 1,
      close: vi.fn(),
      addEventListener: vi.fn().mockImplementation(function (type: string, handler: (e: MessageEvent) => void) {
        if (!eventListeners[type]) eventListeners[type] = []
        eventListeners[type].push(handler)
      }),
      removeEventListener: vi.fn(),
      onerror: null as any,
      onopen: null as any,
      onmessage: null as any
    }
    lastEventSourceInstance = instance
    eventSourceInstances.push(instance)
    if (autoFireInitialize) {
      setTimeout(() => {
        instance.onopen?.({ type: 'open' })
        const initHandlers = eventListeners['initialize'] ?? []
        for (const h of initHandlers) {
          h({ data: JSON.stringify({ serverConfig: { serverVersion: '2.0' }, agents: [] }) } as MessageEvent)
        }
      }, 0)
    }
    return instance
  })
}))

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 202,
  json: () => Promise.resolve({ accepted: true })
})

describe('SSETransport', () => {
  let transport: SSETransport
  let callbacks: ChatTransportCallbacks

  beforeEach(() => {
    eventListeners = {}
    lastEventSourceOptions = null
    lastEventSourceInstance = null
    eventSourceInstances = []
    autoFireInitialize = true
    ;(global.fetch as ReturnType<typeof vi.fn>).mockClear()
    callbacks = {
      onEvent: vi.fn(),
      onStateChange: vi.fn(),
      onError: vi.fn()
    }
    transport = new SSETransport({ baseUrl: 'http://localhost:4000' })
    transport.on(callbacks)
  })

  afterEach(() => {
    transport.destroy()
  })

  it('starts in disconnected state', () => {
    expect(transport.state).toBe('disconnected')
  })

  it('opens EventSource to conversation-scoped stream URL', async () => {
    const { EventSource } = await import('eventsource')
    transport.connect('app_1', 'token_123', 'conv_1')
    expect(EventSource).toHaveBeenCalledWith(
      'http://localhost:4000/api/conversations/app_1/conv_1/stream',
      expect.any(Object)
    )
  })

  it('transitions to connected on initialize event', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })
  })

  it('sends POST to /messages on sendMessage', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    await transport.sendMessage({
      content: 'Hello',
      sessionId: 'sess_1'
    })

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/conversations/app_1/conv_1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer token_123',
          'Content-Type': 'application/json'
        })
      })
    )
  })

  it('includes userTimezone in POST body', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    await transport.sendMessage({
      content: 'Hello',
      sessionId: 'sess_1',
      userTimezone: 'America/New_York',
    })

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => (c[0] as string).includes('/messages')
    )
    const body = JSON.parse(call[1].body)
    expect(body.userTimezone).toBe('America/New_York')
  })

  it('includes rebuildBuildPageSlug in POST body when provided', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    await transport.sendMessage({
      content: 'Build the about page',
      sessionId: 'sess_1',
      rebuildBuildPageSlug: 'about',
    })

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => (c[0] as string).includes('/messages')
    )
    const body = JSON.parse(call[1].body)
    expect(body.rebuildBuildPageSlug).toBe('about')
  })

  it('does not include X-Connection-Id header', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    await transport.sendMessage({ content: 'Hello', sessionId: 's' })

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => (c[0] as string).includes('/messages')
    )
    expect(call[1].headers['X-Connection-Id']).toBeUndefined()
  })

  it('sends POST to /stop on stopGeneration', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    await transport.stopGeneration()

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/conversations/app_1/conv_1/stop',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends POST to /actions on postClientActionResult', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    await transport.postClientActionResult({ requestId: 'r1', success: true, result: 'ok' })

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/conversations/app_1/conv_1/actions',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends POST to /actions/reset-timeout on requestClientActionTimeoutReset', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    await transport.requestClientActionTimeoutReset({ requestId: 'r1' })

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/conversations/app_1/conv_1/actions/reset-timeout',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('does NOT throw when reset-timeout returns non-ok (older agent, best-effort)', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    // Older agent without the route → 404. Must degrade silently, not reject.
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    })

    await expect(
      transport.requestClientActionTimeoutReset({ requestId: 'r1' })
    ).resolves.toBeUndefined()
  })

  it('sends PUT to /grants on emitGrantContext', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    await transport.emitGrantContext({ grants: [], timestamp: Date.now() })

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/conversations/app_1/conv_1/grants',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('throws if sendMessage called before connect', async () => {
    await expect(
      transport.sendMessage({ content: 'Hello', sessionId: 's' })
    ).rejects.toThrow('Not connected')
  })

  it('omits Last-Event-Id on the first fetch (fresh-state signal to server)', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    // Invoke the polyfill's fetch override directly and assert that the
    // first call strips both casings of Last-Event-Id while later calls
    // (polyfill auto-reconnects) preserve the cursor the polyfill injects.
    // Save/restore global.fetch so this stub doesn't leak into later tests.
    const originalFetch = globalThis.fetch
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    globalThis.fetch = fetchStub as unknown as typeof globalThis.fetch

    try {
      lastEventSourceOptions.fetch('http://localhost:4000/api/conversations/app_1/conv_1/stream', {
        headers: {
          'Last-Event-ID': '42',
          'last-event-id': '42',
        },
      })

      const firstCallHeaders = fetchStub.mock.calls[0][1].headers
      expect(firstCallHeaders['Last-Event-ID']).toBeUndefined()
      expect(firstCallHeaders['last-event-id']).toBeUndefined()
      expect(firstCallHeaders['Authorization']).toBe('Bearer token_123')

      lastEventSourceOptions.fetch('http://localhost:4000/api/conversations/app_1/conv_1/stream', {
        headers: {
          'Last-Event-ID': '100',
        },
      })
      const secondCallHeaders = fetchStub.mock.calls[1][1].headers
      expect(secondCallHeaders['Last-Event-ID']).toBe('100')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('closes EventSource on disconnect', () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    transport.disconnect()
    expect(transport.state).toBe('disconnected')
  })

  describe('reconnect cooldown circuit-breaker', () => {
    function fireError(opts?: { status?: number; code?: string; message?: string }) {
      const err = opts ?? { message: 'transport_failure' }
      lastEventSourceInstance?.onerror?.(err)
    }

    it('idle stream that exhausts retries goes dormant — no error, no reopen', async () => {
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 3,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenCalledWith('connected'))

      const es = lastEventSourceInstance
      const countBefore = eventSourceInstances.length

      fireError()
      fireError()
      fireError() // threshold trip while idle

      expect(es.close).toHaveBeenCalled()
      expect(callbacks.onStateChange).toHaveBeenCalledWith('dormant')
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(eventSourceInstances.length).toBe(countBefore) // no reopen
      t.destroy()
    })

    it('reconnectIfNeeded does NOT revive a dormant (idle) transport', async () => {
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 1,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenCalledWith('connected'))

      fireError() // idle → dormant
      expect(callbacks.onStateChange).toHaveBeenCalledWith('dormant')

      const count = eventSourceInstances.length
      t.reconnectIfNeeded()
      expect(eventSourceInstances.length).toBe(count) // focus/visibility cannot revive
      t.destroy()
    })

    it('active-turn outage retries bounded cooldowns then gives up (unreachable)', async () => {
      autoFireInitialize = false // reopens never "succeed", so the budget accumulates
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 1,
        cooldownMs: 10,
        maxActiveCooldowns: 2,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await Promise.resolve()

      // Force an active turn: sendMessage sets state 'streaming' on the 202 POST.
      await t.sendMessage({ content: 'go', sessionId: 's' })
      expect(t.state).toBe('streaming')

      fireError() // cooldown 1 (quiet — no onError)
      expect(callbacks.onError).not.toHaveBeenCalled()
      await new Promise((r) => setTimeout(r, 20)) // timer reopens
      fireError() // cooldown 2
      await new Promise((r) => setTimeout(r, 20)) // timer reopens
      fireError() // budget exhausted → terminal

      expect(callbacks.onStateChange).toHaveBeenCalledWith('error')
      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'sse_transport_unreachable' }),
      )
      t.destroy()
    })

    it('reconnectIfNeeded short-circuits an active cooldown and reopens immediately', async () => {
      autoFireInitialize = false
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 1,
        cooldownMs: 60_000,
        maxActiveCooldowns: 3,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await Promise.resolve()

      await t.sendMessage({ content: 'go', sessionId: 's' }) // state → streaming
      const before = eventSourceInstances.length

      fireError() // active cooldown (long timer; will not fire during the test)
      expect(eventSourceInstances.length).toBe(before) // closed, not yet reopened

      t.reconnectIfNeeded() // user signal short-circuits the cooldown
      expect(eventSourceInstances.length).toBe(before + 1)
      t.destroy()
    })

    it('logs eventsource.error once per streak, not per attempt (AC3)', async () => {
      const warnSpy = logger.warn as ReturnType<typeof vi.fn>
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 5,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenCalledWith('connected'))
      warnSpy.mockClear()

      fireError()
      fireError()
      fireError()
      fireError() // 4 errors, below threshold (5)

      const errorLogs = warnSpy.mock.calls.filter((c) => c[0] === 'sse.transport.eventsource.error')
      expect(errorLogs).toHaveLength(1) // first-of-streak only
      t.destroy()
    })

    it('does not bump the counter on 401 (auth path is separate)', () => {
      autoFireInitialize = false
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 2,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')

      // Fire 401s up to and past the cooldown threshold.
      const firstInstance = lastEventSourceInstance
      firstInstance?.onerror?.({ status: 401 })
      firstInstance?.onerror?.({ status: 401 })
      firstInstance?.onerror?.({ status: 401 })

      // Then a single non-401 must NOT trip cooldown — proves the counter
      // never accumulated 401s. With maxConsecutiveErrors=2, if 401s had
      // contributed, this single error would push past the threshold.
      const latestInstance = lastEventSourceInstance
      latestInstance?.onerror?.({ message: 'transport_failure' })

      expect(callbacks.onStateChange).not.toHaveBeenCalledWith('error')
      t.destroy()
    })

    it('successful initialize resets the consecutive-error counter', async () => {
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 3,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')

      // Wait for the auto-fired initialize to land.
      await vi.waitFor(() => {
        expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
      })

      // Fire below threshold, then reset, then fire below threshold again.
      // Without the reset the second batch would trip cooldown.
      lastEventSourceInstance?.onerror?.({ message: 'a' })
      lastEventSourceInstance?.onerror?.({ message: 'b' })

      // Re-fire initialize to simulate recovery.
      const handlers = eventListeners['initialize'] ?? []
      for (const h of handlers) {
        h({ data: JSON.stringify({ serverConfig: {}, agents: [] }) } as MessageEvent)
      }

      lastEventSourceInstance?.onerror?.({ message: 'c' })
      lastEventSourceInstance?.onerror?.({ message: 'd' })

      expect(lastEventSourceInstance.close).not.toHaveBeenCalled()
      t.destroy()
    })

    it('reconnectIfNeeded is a no-op without live credentials', () => {
      const t = new SSETransport({ baseUrl: 'http://localhost:4000' })
      t.on(callbacks)
      const before = eventSourceInstances.length
      t.reconnectIfNeeded()
      expect(eventSourceInstances.length).toBe(before)
      t.destroy()
    })

    it('reconnectIfNeeded is a no-op when an EventSource is already open and not in cooldown', async () => {
      const t = new SSETransport({ baseUrl: 'http://localhost:4000' })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => {
        expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
      })

      const count = eventSourceInstances.length
      t.reconnectIfNeeded()
      expect(eventSourceInstances.length).toBe(count)
      t.destroy()
    })

    it('disconnect() detaches the visibility listener so focus cannot revive the connection', async () => {
      // Provide minimal window/document mocks so the listener-detach path
      // is actually exercised (this test file runs in node, not jsdom).
      const focusListeners: Array<() => void> = []
      const visibilityListeners: Array<() => void> = []
      const mockWindow = {
        addEventListener: vi.fn(function (_e: string, fn: () => void) { focusListeners.push(fn) }),
        removeEventListener: vi.fn(function (_e: string, fn: () => void) {
          const idx = focusListeners.indexOf(fn)
          if (idx >= 0) focusListeners.splice(idx, 1)
        }),
      }
      const mockDocument = {
        visibilityState: 'visible',
        addEventListener: vi.fn(function (_e: string, fn: () => void) { visibilityListeners.push(fn) }),
        removeEventListener: vi.fn(function (_e: string, fn: () => void) {
          const idx = visibilityListeners.indexOf(fn)
          if (idx >= 0) visibilityListeners.splice(idx, 1)
        }),
      }
      vi.stubGlobal('window', mockWindow)
      vi.stubGlobal('document', mockDocument)

      try {
        const t = new SSETransport({ baseUrl: 'http://localhost:4000' })
        t.on(callbacks)
        t.connect('app_1', 'token_123', 'conv_1')
        await vi.waitFor(() => {
          expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
        })

        // Listener is now attached.
        expect(mockWindow.addEventListener).toHaveBeenCalledWith('focus', expect.any(Function))
        expect(mockDocument.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

        const countBefore = eventSourceInstances.length
        t.disconnect()

        // Detach was called — the key assertion this test exists for.
        expect(mockWindow.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function))
        expect(mockDocument.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

        // Even if a focus fires (via leftover reference), reconnectIfNeeded
        // short-circuits on state === 'disconnected' (defense-in-depth).
        t.reconnectIfNeeded()
        expect(eventSourceInstances.length).toBe(countBefore)
        expect(t.state).toBe('disconnected')
        t.destroy()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('a fresh connect() resets cooldown state', () => {
      autoFireInitialize = false
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 1,
        cooldownMs: 60_000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')

      fireError() // trips cooldown
      const closedFirst = lastEventSourceInstance.close.mock.calls.length

      t.connect('app_2', 'token_456', 'conv_2') // fresh session

      // New EventSource constructed and not closed by an old cooldown timer.
      expect(eventSourceInstances.length).toBeGreaterThan(0)
      expect(lastEventSourceInstance.close.mock.calls.length).toBeLessThanOrEqual(closedFirst)
      t.destroy()
    })

    it('sendMessage re-arms the stream when dormant', async () => {
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 2,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenCalledWith('connected'))

      fireError()
      fireError() // idle → dormant
      expect(callbacks.onStateChange).toHaveBeenCalledWith('dormant')

      const countBefore = eventSourceInstances.length
      await t.sendMessage({ content: 'Hi', sessionId: 's' })

      expect(eventSourceInstances.length).toBe(countBefore + 1) // stream re-armed
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/conversations/app_1/conv_1/messages',
        expect.objectContaining({ method: 'POST' }),
      )
      t.destroy()
    })
  })

  it('forwards validation_message events to onEvent', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    const handlers = eventListeners['validation_message'] ?? []
    expect(handlers.length).toBeGreaterThan(0)

    const payload = {
      conversationId: 'conv_1',
      content: 'validating',
      data: { metadata: { validationStatus: 'running' } },
    }
    for (const h of handlers) {
      h({ data: JSON.stringify(payload) } as MessageEvent)
    }

    expect(callbacks.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'validation_message',
        conversationId: 'conv_1',
        content: 'validating',
      })
    )
  })

  it('parses numeric SSE event IDs into transport sequence', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })
    callbacks.onEvent = vi.fn()

    const handlers = eventListeners.chunk ?? []
    expect(handlers.length).toBeGreaterThan(0)

    for (const h of handlers) {
      h({
        data: JSON.stringify({ conversationId: 'conv_1', content: 'hello' }),
        lastEventId: '42',
      } as MessageEvent)
    }

    expect(callbacks.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chunk',
      sequence: 42,
    }))
  })

  it('omits transport sequence for missing or non-numeric SSE event IDs', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })
    callbacks.onEvent = vi.fn()

    const handlers = eventListeners.chunk ?? []
    expect(handlers.length).toBeGreaterThan(0)

    for (const h of handlers) {
      h({
        data: JSON.stringify({ conversationId: 'conv_1', content: 'bad id' }),
        lastEventId: 'not-a-number',
      } as MessageEvent)
      h({
        data: JSON.stringify({ conversationId: 'conv_1', content: 'missing id' }),
      } as MessageEvent)
    }

    expect(callbacks.onEvent).toHaveBeenCalledTimes(2)
    expect(callbacks.onEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'chunk',
      sequence: undefined,
    }))
    expect(callbacks.onEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'chunk',
      sequence: undefined,
    }))
  })

  describe('SSEQualityMonitor wiring', () => {
    function makeMonitor() {
      return {
        markConnectStart: vi.fn(),
        recordConnectPhases: vi.fn(),
        markStreamOpenStart: vi.fn(),
        markFirstStreamEvent: vi.fn(),
        markSend: vi.fn(),
        markFirstResponse: vi.fn(),
        clearSend: vi.fn(),
        recordEventSourceError: vi.fn(),
        resetErrorBuckets: vi.fn(),
        destroy: vi.fn(),
      }
    }

    it('calls markStreamOpenStart on connect with the stream URL', () => {
      const monitor = makeMonitor()
      const transport = new SSETransport({ baseUrl: 'https://agent.example', qualityMonitor: monitor as any })
      transport.on({ onEvent: vi.fn(), onStateChange: vi.fn(), onError: vi.fn() })
      transport.connect('app123456', 'token_123', 'conv1')

      expect(monitor.markStreamOpenStart).toHaveBeenCalledTimes(1)
      expect(monitor.markStreamOpenStart.mock.calls[0][0]).toContain('/stream')
    })

    it('fires markFirstStreamEvent exactly once for the first dispatched event', () => {
      autoFireInitialize = false
      const monitor = makeMonitor()
      const transport = new SSETransport({ baseUrl: 'https://agent.example', qualityMonitor: monitor as any })
      transport.on({ onEvent: vi.fn(), onStateChange: vi.fn(), onError: vi.fn() })
      transport.connect('app123456', 'token_123', 'conv1')

      const fire = (type: string, data: unknown) => {
        for (const h of eventListeners[type] ?? []) h({ data: JSON.stringify(data), lastEventId: '1' } as MessageEvent)
      }
      fire('recovery_status', { hasBufferedEvents: false })
      fire('chunk', { content: 'hi' })

      expect(monitor.markFirstStreamEvent).toHaveBeenCalledTimes(1)

      autoFireInitialize = true
      transport.destroy()
    })

    it('fires markFirstStreamEvent once when initialize arrives before typed events', () => {
      autoFireInitialize = false
      const monitor = makeMonitor()
      const transport = new SSETransport({ baseUrl: 'https://agent.example', qualityMonitor: monitor as any })
      transport.on({ onEvent: vi.fn(), onStateChange: vi.fn(), onError: vi.fn() })
      transport.connect('app123456', 'token_123', 'conv1')

      for (const h of eventListeners['initialize'] ?? []) {
        h({ data: JSON.stringify({ serverConfig: { serverVersion: '2.0' }, agents: [] }) } as MessageEvent)
      }
      for (const h of eventListeners['chunk'] ?? []) h({ data: JSON.stringify({ content: 'hi' }), lastEventId: '1' } as MessageEvent)

      expect(monitor.markFirstStreamEvent).toHaveBeenCalledTimes(1)
      autoFireInitialize = true
    })

    it('reports consecutive errors and resets buckets on initialize', () => {
      autoFireInitialize = false
      const monitor = makeMonitor()
      const transport = new SSETransport({ baseUrl: 'https://agent.example', qualityMonitor: monitor as any })
      transport.on({ onEvent: vi.fn(), onStateChange: vi.fn(), onError: vi.fn() })
      transport.connect('app123456', 'token_123', 'conv1')

      lastEventSourceInstance.onerror({ status: 500 })
      lastEventSourceInstance.onerror({ status: 500 })
      expect(monitor.recordEventSourceError).toHaveBeenCalledTimes(2)
      expect(monitor.recordEventSourceError).toHaveBeenLastCalledWith(2)

      for (const h of eventListeners['initialize'] ?? []) {
        h({ data: JSON.stringify({ serverConfig: { serverVersion: '2.0' }, agents: [] }) } as MessageEvent)
      }
      expect(monitor.resetErrorBuckets).toHaveBeenCalledTimes(1)

      autoFireInitialize = true
      transport.destroy()
    })

    it('does not fire markFirstStreamEvent for native (non-string) error events', () => {
      const monitor = makeMonitor()
      const transport = new SSETransport({ baseUrl: 'https://agent.example', qualityMonitor: monitor as any })
      transport.on({ onEvent: vi.fn(), onStateChange: vi.fn(), onError: vi.fn() })
      transport.connect('app123456', 'token_123', 'conv1')

      for (const h of eventListeners['chunk'] ?? []) h({ data: undefined } as unknown as MessageEvent)
      expect(monitor.markFirstStreamEvent).not.toHaveBeenCalled()

      transport.destroy()
    })
  })

  describe('loadHistory', () => {
    it('emits history_complete with preserved cursor on pagination failure', async () => {
      transport.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => {
        expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
      })

      // Mock a failed paginated fetch
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })

      transport.loadHistory({ cursor: 'cursor-abc', limit: 20 })

      await vi.waitFor(() => {
        expect(callbacks.onEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'history_complete',
            data: expect.objectContaining({
              error: expect.any(String),
              hasMore: true,
              nextCursor: 'cursor-abc',
              messageCount: 0,
            }),
          })
        )
      })
    })

    it('emits history_loaded with hasMore false on initial load failure', async () => {
      transport.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => {
        expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
      })

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })

      transport.loadHistory()

      await vi.waitFor(() => {
        expect(callbacks.onEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'history_loaded',
            data: expect.objectContaining({
              error: expect.any(String),
              hasMore: false,
              nextCursor: null,
              messageCount: 0,
            }),
          })
        )
      })
    })
  })
})
