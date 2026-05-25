/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SSETransport } from '../SSETransport'
import type { ChatTransportCallbacks } from '../types'

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn((url: string, init: any) => {
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

let eventListeners: Record<string, Array<(e: MessageEvent) => void>> = {}
let lastEventSourceOptions: any = null
let lastEventSourceInstance: any = null
let eventSourceInstances: any[] = []
let autoFireInitialize = true

vi.mock('eventsource', () => ({
  EventSource: vi.fn().mockImplementation((url: string, options: any) => {
    lastEventSourceOptions = options
    const instance = {
      url,
      readyState: 1,
      close: vi.fn(),
      addEventListener: vi.fn().mockImplementation((type: string, handler: (e: MessageEvent) => void) => {
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

    it('enters cooldown after maxConsecutiveErrors and closes the EventSource', () => {
      autoFireInitialize = false
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 3,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')

      const es = lastEventSourceInstance

      fireError()
      fireError()
      expect(es.close).not.toHaveBeenCalled()

      fireError() // threshold trip
      expect(es.close).toHaveBeenCalled()
      expect(callbacks.onStateChange).toHaveBeenCalledWith('error')
      expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({
        message: 'sse_transport_cooldown',
      }))

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

    it('reconnectIfNeeded short-circuits cooldown and reopens immediately', async () => {
      autoFireInitialize = false
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 2,
        cooldownMs: 60_000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      // Flush the queueMicrotask in openEventSource so `reconnecting` clears.
      await Promise.resolve()
      const initialCount = eventSourceInstances.length

      fireError()
      fireError() // trips cooldown

      const afterTripCount = eventSourceInstances.length
      expect(afterTripCount).toBe(initialCount) // no reopen during cooldown

      t.reconnectIfNeeded()

      expect(eventSourceInstances.length).toBe(afterTripCount + 1)
      t.destroy()
    })

    it('cooldown timer auto-reopens when it fires', async () => {
      autoFireInitialize = false
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 1,
        cooldownMs: 30,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      const initialCount = eventSourceInstances.length

      fireError() // trips cooldown immediately

      await new Promise((r) => setTimeout(r, 60))

      expect(eventSourceInstances.length).toBeGreaterThan(initialCount)
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
        addEventListener: vi.fn((_e: string, fn: () => void) => { focusListeners.push(fn) }),
        removeEventListener: vi.fn((_e: string, fn: () => void) => {
          const idx = focusListeners.indexOf(fn)
          if (idx >= 0) focusListeners.splice(idx, 1)
        }),
      }
      const mockDocument = {
        visibilityState: 'visible',
        addEventListener: vi.fn((_e: string, fn: () => void) => { visibilityListeners.push(fn) }),
        removeEventListener: vi.fn((_e: string, fn: () => void) => {
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
