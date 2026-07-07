/**
 * MCP Session Tests
 *
 * Covers the streamable-HTTP lifecycle implemented in ../session.ts:
 *
 *   1. initialize produces Mcp-Session-Id + capture of Set-Cookie
 *   2. Subsequent raw requests carry Mcp-Session-Id + Cookie + Bearer
 *   3. Missing Mcp-Session-Id on initialize response -> throws
 *   4. Initialize HTTP error -> throws McpUpstreamError with status
 *   5. runWithMcpSession retries on "Session not found" errors
 *   6. runWithMcpSession does NOT retry on arbitrary errors
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { McpUpstreamError, runWithMcpSession } from '../session'

/**
 * Pull (url, init) out of a fetch mock call with proper typing so we
 * can read headers/body without the `unknown` inference that vitest
 * gives you from `mock.calls[n]`.
 */
function fetchCall(
  spy: ReturnType<typeof vi.spyOn>,
  index: number,
): { url: string; init: RequestInit; headers: Record<string, string>; body: string } {
  const raw = spy.mock.calls[index]
  if (!raw) throw new Error(`fetch was not called ${index + 1} times`)
  const [url, init] = raw as unknown as [string, RequestInit]
  return {
    url,
    init,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: typeof init.body === 'string' ? init.body : '',
  }
}

function makeInitResponse(sessionId: string, setCookie?: string | string[]): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.set('mcp-session-id', sessionId)
  if (setCookie) {
    if (Array.isArray(setCookie)) {
      for (const c of setCookie) headers.append('set-cookie', c)
    } else {
      headers.set('set-cookie', setCookie)
    }
  }
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'mock', version: '1.0.0' },
      },
    }),
    { status: 200, headers },
  )
}

describe('runWithMcpSession', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    // vitest 4: clearMocks doesn't drain mockResolvedValueOnce queues.
    vi.resetAllMocks()
  })

  const baseOptions = {
    url: 'https://mcp.example.com/mcp',
    serverId: 'commerce',
    customerId: 'cust-1',
    accessToken: 'bearer-abc',
  }

  it('sends initialize + notifications/initialized before the real request', async () => {
    fetchSpy.mockResolvedValueOnce(makeInitResponse('sess-1'))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 202 }))
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await runWithMcpSession(baseOptions, (client) =>
      client.sendRaw({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    )

    expect(result.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(3)

    const init = fetchCall(fetchSpy, 0)
    expect(JSON.parse(init.body).method).toBe('initialize')
    expect(init.headers['Authorization']).toBe('Bearer bearer-abc')
    expect(init.headers['MCP-Protocol-Version']).toBe('2024-11-05')
    // no session id yet on initialize
    expect(init.headers['Mcp-Session-Id']).toBeUndefined()

    const notify = fetchCall(fetchSpy, 1)
    expect(JSON.parse(notify.body).method).toBe('notifications/initialized')
    expect(notify.headers['Mcp-Session-Id']).toBe('sess-1')

    const real = fetchCall(fetchSpy, 2)
    expect(JSON.parse(real.body).method).toBe('tools/list')
    expect(real.headers['Mcp-Session-Id']).toBe('sess-1')
  })

  it('captures Set-Cookie from initialize and forwards as Cookie on later requests', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeInitResponse('sess-cookie', 'AWSALB=abc; Path=/; Max-Age=3600'),
    )
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 202 }))
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await runWithMcpSession(baseOptions, (client) =>
      client.sendRaw({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    )

    expect(fetchCall(fetchSpy, 1).headers['Cookie']).toBe('AWSALB=abc')
    expect(fetchCall(fetchSpy, 2).headers['Cookie']).toBe('AWSALB=abc')
  })

  it('uses protocol version and initialize capabilities from options', async () => {
    fetchSpy.mockResolvedValueOnce(makeInitResponse('sess-1'))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 202 }))
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await runWithMcpSession(
      {
        ...baseOptions,
        protocolVersion: '2025-11-25',
        initializeCapabilities: { sampling: {} },
      },
      (client) => client.sendRaw({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    )

    const init = fetchCall(fetchSpy, 0)
    expect(init.headers['MCP-Protocol-Version']).toBe('2025-11-25')
    const initBody = JSON.parse(init.body)
    expect(initBody.params.protocolVersion).toBe('2025-11-25')
    expect(initBody.params.capabilities).toEqual({ sampling: {} })
  })

  it('throws McpUpstreamError if initialize HTTP fails', async () => {
    // MAX_RETRIES is 3; each attempt does its own initialize, so queue
    // three failing responses.
    const bad = () => new Response('boom', { status: 500 })
    fetchSpy.mockResolvedValueOnce(bad())
    fetchSpy.mockResolvedValueOnce(bad())
    fetchSpy.mockResolvedValueOnce(bad())

    await expect(
      runWithMcpSession(baseOptions, (client) =>
        client.sendRaw({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      ),
    ).rejects.toBeInstanceOf(McpUpstreamError)
  })

  it('throws McpUpstreamError if initialize omits Mcp-Session-Id', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      runWithMcpSession(baseOptions, (client) =>
        client.sendRaw({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      ),
    ).rejects.toBeInstanceOf(McpUpstreamError)
  })

  it('retries when operation throws a session-invalid error', async () => {
    // Attempt 1: initialize OK, notify OK, operation throws "Session not found".
    fetchSpy.mockResolvedValueOnce(makeInitResponse('sess-1'))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 202 }))
    // Attempt 2: initialize OK, notify OK, operation succeeds.
    fetchSpy.mockResolvedValueOnce(makeInitResponse('sess-2'))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 202 }))

    let calls = 0
    const result = await runWithMcpSession(baseOptions, async () => {
      calls += 1
      if (calls === 1) throw new Error('Session not found')
      return { status: 200, contentType: 'application/json', body: '{"ok":true}' }
    })

    expect(result.body).toBe('{"ok":true}')
    expect(calls).toBe(2)
    // 2 initialize + 2 notify = 4 handshake fetches.
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('does NOT retry on arbitrary errors', async () => {
    fetchSpy.mockResolvedValueOnce(makeInitResponse('sess-1'))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 202 }))

    let calls = 0
    await expect(
      runWithMcpSession(baseOptions, async () => {
        calls += 1
        throw new Error('unrelated failure')
      }),
    ).rejects.toThrow(/unrelated failure/)

    expect(calls).toBe(1)
    // Only one initialize attempt.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
