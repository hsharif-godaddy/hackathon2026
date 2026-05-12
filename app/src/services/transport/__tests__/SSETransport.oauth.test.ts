/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SSETransport } from '../SSETransport'
import type { ChatTransportCallbacks } from '../types'

// Stand-alone jsdom-env suite specifically for the oauth_result dispatch path,
// which relies on `window.dispatchEvent`. The main SSETransport.test.ts runs
// in node env for fetch semantics; keep that separation rather than converting.

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn((url: string, init: any) => fetch(url, init)),
  getAgentToken: vi.fn().mockResolvedValue('token_123'),
  clearAgentTokenCache: vi.fn(),
}))

let eventListeners: Record<string, Array<(e: MessageEvent) => void>> = {}

vi.mock('eventsource', () => ({
  EventSource: vi.fn().mockImplementation(() => {
    const instance = {
      readyState: 1,
      close: vi.fn(),
      addEventListener: vi.fn().mockImplementation((type: string, handler: (e: MessageEvent) => void) => {
        eventListeners[type] ||= []
        eventListeners[type].push(handler)
      }),
      removeEventListener: vi.fn(),
      onerror: null,
      onopen: null,
      onmessage: null,
    }
    setTimeout(() => {
      const initHandlers = eventListeners['initialize'] ?? []
      for (const h of initHandlers) {
        h({ data: JSON.stringify({ serverConfig: { serverVersion: '2.0' }, agents: [] }) } as MessageEvent)
      }
    }, 0)
    return instance
  }),
}))

global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 202, json: () => Promise.resolve({}) })

function fireEvent(type: string, data: unknown): void {
  const handlers = eventListeners[type] ?? []
  for (const h of handlers) {
    h({ data: JSON.stringify(data) } as MessageEvent)
  }
}

describe('SSETransport oauth_result dispatch', () => {
  let transport: SSETransport
  let callbacks: ChatTransportCallbacks

  beforeEach(() => {
    eventListeners = {}
    callbacks = { onEvent: vi.fn(), onStateChange: vi.fn(), onError: vi.fn() }
    transport = new SSETransport({ baseUrl: 'http://localhost:4000' })
    transport.on(callbacks)
    transport.connect('app_1', 'token_123', 'conv_1')
  })

  afterEach(() => {
    transport.destroy()
  })

  it('dispatches window CustomEvent("oauth:result") on oauth_result wire event', async () => {
    await vi.waitFor(() => expect(eventListeners['oauth_result']).toBeDefined())

    const listener = vi.fn()
    window.addEventListener('oauth:result', listener)
    try {
      const payload = {
        success: true,
        appId: 'app_1',
        state: 'state-1',
        provider: 'godaddy',
      }
      fireEvent('oauth_result', payload)

      expect(listener).toHaveBeenCalledTimes(1)
      const event = listener.mock.calls[0]?.[0] as CustomEvent
      expect(event.detail).toEqual(payload)
    } finally {
      window.removeEventListener('oauth:result', listener)
    }
  })

  it('does not forward oauth_result through the conversation onEvent callback', async () => {
    await vi.waitFor(() => expect(eventListeners['oauth_result']).toBeDefined())

    ;(callbacks.onEvent as ReturnType<typeof vi.fn>).mockClear()
    fireEvent('oauth_result', { success: true, appId: 'app_1', state: 's', provider: 'godaddy' })

    const forwarded = (callbacks.onEvent as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as { type: string }).type === 'oauth_result',
    )
    expect(forwarded).toBeUndefined()
  })
})
