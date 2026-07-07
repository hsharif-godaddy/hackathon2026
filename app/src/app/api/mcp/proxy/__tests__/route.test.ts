/**
 * MCP Proxy Route Tests
 *
 * Covers:
 *   - customer auth wrapper (unauthenticated rejection)
 *   - body validation (serverId, request shape)
 *   - allowlist enforcement
 *   - policy denials (disallowed method, blocked tool, missing tool name)
 *   - token-exchange wiring (scope selection)
 *   - upstream forwarding + response normalization (JSON and SSE)
 *   - error propagation from token exchange / upstream network
 *
 * Every successful request now performs three upstream fetches:
 *   (1) initialize           -> 200 with Mcp-Session-Id response header
 *   (2) notifications/init   -> 202
 *   (3) the actual JSON-RPC  -> test-specific mock
 *
 * Helpers at the bottom of this file pre-queue (1) + (2) for each test.
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateCustomer,
  mockExchangeToken,
  mockResetTokenCache,
  mockResetServerRegistry,
  mockCheckSwitchboardFlag,
} = vi.hoisted(() => ({
  mockAuthenticateCustomer: vi.fn(),
  mockExchangeToken: vi.fn(),
  mockResetTokenCache: vi.fn(),
  mockResetServerRegistry: vi.fn(),
  mockCheckSwitchboardFlag: vi.fn(),
}))

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>(
    '@/lib/customer-auth',
  )
  return {
    ...actual,
    withCustomerAuth: vi.fn(function (handler: any) {
      return async (request: NextRequest, ...rest: any[]) => {
        const authContext = await mockAuthenticateCustomer(request)
        if (!authContext.isAuthenticated) {
          return new Response(JSON.stringify({ error: authContext.error }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }
        return handler(request, authContext, ...rest)
      }
    }),
  }
})

vi.mock('@/lib/mcp/token-exchange', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mcp/token-exchange')>(
    '@/lib/mcp/token-exchange',
  )
  return {
    ...actual,
    exchangeCustomerJwtForOAuthToken: mockExchangeToken,
    __resetMcpTokenCacheForTests: mockResetTokenCache,
  }
})

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

interface TestMcpServerConfig {
  id: string
  displayName: string
  url: string
  protocolVersion: string
  initializeCapabilities: Record<string, unknown>
  allowedScopes: readonly string[]
  discoveryScopes: readonly string[]
}

function registerCommerceServerWithProtocol(
  protocolVersion: string,
  id: string,
): (registry: Record<string, TestMcpServerConfig>) => void {
  return (registry) => {
    registry[id] = {
      ...registry.commerce!,
      id,
      protocolVersion,
    }
  }
}

// Import route AFTER mocks are registered.
async function getRouteHandler(
  configureServers?: (registry: Record<string, TestMcpServerConfig>) => void,
) {
  // Must also ensure env is set before the servers module reads it.
  process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com'
  delete process.env.COMMERCE_MCP_URL
  const serversModule = await import('@/lib/mcp/servers')
  serversModule.__resetMcpServerRegistryForTests()
  configureServers?.(serversModule.getMcpServerRegistry() as Record<string, TestMcpServerConfig>)
  const { POST } = await import('../route')
  return POST as (req: NextRequest) => Promise<Response>
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/mcp/proxy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const AUTHED = {
  isAuthenticated: true,
  user: { shopperId: 'shop-1', customerId: 'cust-1', accountId: 'acct-1' },
  jwt: 'customer-jwt',
}

const ORIGINAL_ENV = { ...process.env }

/**
 * Queue the two handshake responses (initialize + notifications/initialized)
 * that runWithMcpSession performs before the real JSON-RPC request. Call
 * this in every test that reaches the upstream fetch path.
 */
function queueHandshakeResponses(fetchSpy: ReturnType<typeof vi.spyOn>): void {
  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'mock', version: '1.0.0' },
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'sess-abc123',
        },
      },
    ),
  )
  fetchSpy.mockResolvedValueOnce(new Response(null, { status: 202 }))
}

describe('POST /api/mcp/proxy', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      GODADDY_API_BASE_URL: 'https://api.dev-godaddy.com',
      AIRO_APP_BUILDER_CLIENT_ID: 'id',
      AIRO_APP_BUILDER_CLIENT_SECRET: 'secret',
    }
    mockAuthenticateCustomer.mockReset()
    mockExchangeToken.mockReset()
    mockCheckSwitchboardFlag.mockReset()
    mockExchangeToken.mockResolvedValue({ accessToken: 'oauth-token', cached: false })
    mockCheckSwitchboardFlag.mockResolvedValue(false)
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
  })

  it('rejects unauthenticated callers with 401', async () => {
    mockAuthenticateCustomer.mockResolvedValueOnce({
      isAuthenticated: false,
      user: null,
      error: 'no token',
    })
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects missing JWT even when authenticated', async () => {
    mockAuthenticateCustomer.mockResolvedValueOnce({ ...AUTHED, jwt: undefined })
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects unknown serverId', async () => {
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'not-a-server',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/unknown serverId/)
  })

  it('rejects missing serverId', async () => {
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects invalid JSON-RPC body', async () => {
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { method: 'tools/call' }, // missing jsonrpc
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects disallowed JSON-RPC method', async () => {
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'notifications/initialized', id: 1 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('forwards tools/list with discovery scope, attaches Bearer + session headers', async () => {
    queueHandshakeResponses(fetchSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { jsonrpc: string; result: unknown }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.result).toEqual({ tools: [] })

    expect(mockExchangeToken).toHaveBeenCalledTimes(1)
    const call = mockExchangeToken.mock.calls[0]![0]
    expect(call.scopes).toEqual(['openid'])
    expect(call.serverId).toBe('commerce')

    // 1: initialize, 2: notifications/initialized, 3: real tools/list.
    expect(fetchSpy).toHaveBeenCalledTimes(3)

    const initCall = fetchSpy.mock.calls[0]! as [string, RequestInit]
    expect(initCall[0]).toBe('https://mcp.commerce.api.dev-godaddy.com/mcp')
    const initHeaders = initCall[1].headers as Record<string, string>
    expect(initHeaders['Authorization']).toBe('Bearer oauth-token')
    expect(initHeaders['MCP-Protocol-Version']).toBe('2024-11-05')
    const initBody = JSON.parse(initCall[1].body as string)
    expect(initBody.method).toBe('initialize')
    expect(initBody.params.capabilities).toEqual({})
    expect(mockCheckSwitchboardFlag).not.toHaveBeenCalled()

    const realCall = fetchSpy.mock.calls[2]! as [string, RequestInit]
    const realHeaders = realCall[1].headers as Record<string, string>
    expect(realHeaders['Mcp-Session-Id']).toBe('sess-abc123')
    expect(JSON.parse(realCall[1].body as string).method).toBe('tools/list')
  })

  it('does not advertise MCP elicitation initialize capabilities for pre-2025-06-18 protocol servers', async () => {
    mockCheckSwitchboardFlag.mockResolvedValueOnce(true)
    queueHandshakeResponses(fetchSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )

    expect(res.status).toBe(200)
    const initCall = fetchSpy.mock.calls[0]! as [string, RequestInit]
    const initBody = JSON.parse(initCall[1].body as string)
    expect(initBody.params.capabilities).toEqual({})
    expect(mockCheckSwitchboardFlag).not.toHaveBeenCalled()
  })

  it('advertises base MCP elicitation initialize capability for 2025-06-18 protocol servers', async () => {
    mockCheckSwitchboardFlag.mockResolvedValueOnce(true)
    queueHandshakeResponses(fetchSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const POST = await getRouteHandler(
      registerCommerceServerWithProtocol('2025-06-18', 'commerce-2025'),
    )
    const res = await POST(
      makeRequest({
        serverId: 'commerce-2025',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )

    expect(res.status).toBe(200)
    const initCall = fetchSpy.mock.calls[0]! as [string, RequestInit]
    const initHeaders = initCall[1].headers as Record<string, string>
    expect(initHeaders['MCP-Protocol-Version']).toBe('2025-06-18')
    const initBody = JSON.parse(initCall[1].body as string)
    expect(initBody.params.capabilities).toEqual({ elicitation: {} })
    expect(mockCheckSwitchboardFlag).toHaveBeenCalledWith(
      'aab-mcp-elicitation',
      expect.any(NextRequest),
    )
  })

  it('advertises MCP elicitation mode capabilities for 2025-11-25 protocol servers', async () => {
    mockCheckSwitchboardFlag.mockResolvedValueOnce(true)
    queueHandshakeResponses(fetchSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const POST = await getRouteHandler(
      registerCommerceServerWithProtocol('2025-11-25', 'commerce-2025-11-25'),
    )
    const res = await POST(
      makeRequest({
        serverId: 'commerce-2025-11-25',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )

    expect(res.status).toBe(200)
    const initCall = fetchSpy.mock.calls[0]! as [string, RequestInit]
    const initHeaders = initCall[1].headers as Record<string, string>
    expect(initHeaders['MCP-Protocol-Version']).toBe('2025-11-25')
    const initBody = JSON.parse(initCall[1].body as string)
    expect(initBody.params.capabilities).toEqual({
      elicitation: { form: {}, url: {} },
    })
    expect(mockCheckSwitchboardFlag).toHaveBeenCalledWith(
      'aab-mcp-elicitation',
      expect.any(NextRequest),
    )
  })

  it('fails closed when the MCP elicitation Switchboard lookup fails', async () => {
    mockCheckSwitchboardFlag.mockRejectedValueOnce(new Error('switchboard unavailable'))
    queueHandshakeResponses(fetchSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const POST = await getRouteHandler(
      registerCommerceServerWithProtocol('2025-06-18', 'commerce-2025'),
    )
    const res = await POST(
      makeRequest({
        serverId: 'commerce-2025',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )

    expect(res.status).toBe(200)
    const initCall = fetchSpy.mock.calls[0]! as [string, RequestInit]
    const initBody = JSON.parse(initCall[1].body as string)
    expect(initBody.params.capabilities).toEqual({})
  })

  it('uses discovery scopes for search_tools, allowed ceiling for named tool', async () => {
    // Two requests -> two handshakes + two real calls.
    queueHandshakeResponses(fetchSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    queueHandshakeResponses(fetchSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const POST = await getRouteHandler()
    await POST(
      makeRequest({
        serverId: 'commerce',
        request: {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 1,
          params: { name: 'search_tools', arguments: { query: 'x' } },
        },
      }),
    )
    expect(mockExchangeToken.mock.calls.at(-1)![0].scopes).toEqual(['openid'])

    await POST(
      makeRequest({
        serverId: 'commerce',
        request: {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 2,
          params: { name: 'catalog_sku_search', arguments: { storeId: 'store-1' } },
        },
      }),
    )
    const scopes = mockExchangeToken.mock.calls.at(-1)![0].scopes
    expect(scopes).toContain('commerce.product:read')
    expect(scopes).toContain('commerce.product:write')
    expect(scopes).toContain('commerce.store:read')
    expect(scopes).toContain('commerce.order:read')
    expect(scopes).toContain('apps.app-registry:write')
    // Still outside the approved scope ceiling -> must not be requested.
    expect(scopes).not.toContain('commerce.store:create')
    expect(scopes).not.toContain('commerce.transaction:write')
  })

  it('normalizes SSE upstream responses to JSON-RPC', async () => {
    queueHandshakeResponses(fetchSpy)
    const sse = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
      '',
    ].join('\n') + '\n\n'
    fetchSpy.mockResolvedValueOnce(
      new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 1,
          params: { name: 'search_tools', arguments: { query: 'catalog' } },
        },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { ok: boolean } }
    expect(body.result.ok).toBe(true)
  })

  it('propagates upstream 403 with JSON body', async () => {
    queueHandshakeResponses(fetchSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'insufficient_scope' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 1,
          params: { name: 'catalog_sku_group_create', arguments: { storeId: 'store-1' } },
        },
      }),
    )
    expect(res.status).toBe(403)
  })

  it('forwards upstream status when initialize fails', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('initialize boom', { status: 500 }),
    )
    // Subsequent retries from runWithMcpSession will also see the same
    // transport error; queue enough responses to survive MAX_RETRIES=3.
    fetchSpy.mockResolvedValue(new Response('initialize boom', { status: 500 }))
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    // initialize failure surfaces as McpUpstreamError with upstream
    // status (500) -> proxy forwards it.
    expect(res.status).toBe(500)
  })

  it('returns 502 on upstream network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'))
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(502)
  })

  it('returns token-exchange error status when exchange fails', async () => {
    const { TokenExchangeError } = await import('@/lib/mcp/token-exchange')
    mockExchangeToken.mockRejectedValueOnce(
      new TokenExchangeError('oauth bad', 400, 'invalid_grant'),
    )
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 503 with an actionable message for MCP proxy configuration errors', async () => {
    mockExchangeToken.mockRejectedValueOnce(
      new Error('MCP token exchange requires AIRO_APP_BUILDER_CLIENT_ID and AIRO_APP_BUILDER_CLIENT_SECRET'),
    )
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('mcp_proxy: configuration error')
    expect(body.error).toContain('AIRO_APP_BUILDER_CLIENT_ID')
  })

  it('returns 502 with a message for token exchange failures before an OAuth response', async () => {
    mockExchangeToken.mockRejectedValueOnce(new Error('fetch failed'))
    const POST = await getRouteHandler()
    const res = await POST(
      makeRequest({
        serverId: 'commerce',
        request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      }),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('mcp_proxy: token exchange failed before response: fetch failed')
  })
})
