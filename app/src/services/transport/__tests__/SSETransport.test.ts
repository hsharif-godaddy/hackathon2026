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

vi.mock('eventsource', () => ({
  EventSource: vi.fn().mockImplementation((url: string, _options: any) => {
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
    setTimeout(() => {
      instance.onopen?.({ type: 'open' })
      const initHandlers = eventListeners['initialize'] ?? []
      for (const h of initHandlers) {
        h({ data: JSON.stringify({ serverConfig: { serverVersion: '2.0' }, agents: [] }) } as MessageEvent)
      }
    }, 0)
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

  it('closes EventSource on disconnect', () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    transport.disconnect()
    expect(transport.state).toBe('disconnected')
  })
})
