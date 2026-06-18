/**
 * MCP Call Action Tests
 *
 * Covers the same-origin BFF bridge behavior:
 *   - new { serverId, request } shape
 *   - legacy { serverUrl, toolName, input } shape (translated)
 *   - result normalization + error surfacing
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mcpCallAction } from './mcpCallAction'
import type { ClientActionContext } from './types'

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const baseContext: ClientActionContext = { currentAppId: 'app-1' }

function mockProxyResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers ?? { 'content-type': 'application/json' },
  })
}

describe('mcpCallAction', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  describe('parameter validation', () => {
    it('rejects non-object params', async () => {
      await expect(mcpCallAction('oops' as unknown as Record<string, unknown>, baseContext))
        .rejects.toThrow(/params must be an object/)
    })

    it('rejects params missing both shapes', async () => {
      await expect(mcpCallAction({}, baseContext)).rejects.toThrow(
        /serverId.*request.*toolName/,
      )
    })

    it('rejects non-string serverId for v2 shape', async () => {
      await expect(
        mcpCallAction(
          {
            serverId: 123,
            request: { jsonrpc: '2.0', method: 'tools/list' },
          } as unknown as Record<string, unknown>,
          baseContext,
        ),
      ).rejects.toThrow(/serverId must be a non-empty string/)
    })
  })

  describe('v2 shape', () => {
    it('POSTs same-origin to /api/mcp/proxy with serverId + request', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockProxyResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
      )
      const result = await mcpCallAction(
        {
          serverId: 'commerce',
          request: {
            jsonrpc: '2.0',
            method: 'tools/call',
            id: 1,
            params: { name: 'search_tools', arguments: { query: 'foo' } },
          },
        },
        baseContext,
      )
      expect(result).toEqual({ ok: true })
      const [url, init] = fetchSpy.mock.calls[0]! as unknown as [string, RequestInit]
      expect(url).toBe('/api/mcp/proxy')
      expect(init.method).toBe('POST')
      expect(init.credentials).toBe('include')
      const body = JSON.parse(init.body as string) as { serverId: string; appId?: string; request: { method: string } }
      expect(body.serverId).toBe('commerce')
      expect(body.appId).toBe('app-1')
      expect(body.request.method).toBe('tools/call')
    })
  })

  describe('legacy shape', () => {
    it('translates { toolName, input } into a tools/call request', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockProxyResponse({ jsonrpc: '2.0', id: 1, result: { legacy: true } }),
      )
      const result = await mcpCallAction(
        {
          serverUrl: 'https://ignored.example.com/mcp',
          toolName: 'commerce_store_setup',
          input: { storeName: 'test' },
        },
        baseContext,
      )
      expect(result).toEqual({ legacy: true })
      const legacyInit = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(legacyInit.body as string) as {
        serverId: string
        request: { method: string; params: { name: string; arguments: Record<string, unknown> } }
      }
      expect(body.serverId).toBe('commerce')
      expect(body.request.method).toBe('tools/call')
      expect(body.request.params.name).toBe('commerce_store_setup')
      expect(body.request.params.arguments).toEqual({ storeName: 'test' })
    })

    it('accepts explicit serverId override in legacy shape', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockProxyResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      )
      await mcpCallAction(
        {
          serverUrl: 'https://ignored.example.com/mcp',
          serverId: 'future-server',
          toolName: 'x',
          input: {},
        },
        baseContext,
      )
      const overrideInit = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(overrideInit.body as string) as { serverId: string }
      expect(body.serverId).toBe('future-server')
    })
  })

  describe('error handling', () => {
    it('throws with the proxy error message on non-2xx', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockProxyResponse({ error: 'mcp_proxy: tool is blocked by policy: dangerous' }, { status: 403 }),
      )
      await expect(
        mcpCallAction(
          {
            serverId: 'commerce',
            request: {
              jsonrpc: '2.0',
              method: 'tools/call',
              id: 1,
              params: { name: 'dangerous', arguments: {} },
            },
          },
          baseContext,
        ),
      ).rejects.toThrow(/tool is blocked/)
    })

    it('includes BFF auth failure details on non-2xx', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockProxyResponse(
          {
            error: 'Unauthorized',
            message: 'Level 3 authentication requires a recent heartbeat',
            authReason: 2,
          },
          { status: 401 },
        ),
      )
      await expect(
        mcpCallAction(
          {
            serverId: 'commerce',
            request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
          },
          baseContext,
        ),
      ).rejects.toThrow(/recent heartbeat.*authReason=2/)
    })

    it('throws when JSON-RPC body contains an error', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockProxyResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }),
      )
      await expect(
        mcpCallAction(
          {
            serverId: 'commerce',
            request: { jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'x' } },
          },
          baseContext,
        ),
      ).rejects.toThrow(/Method not found/)
    })

    it('throws on network failures', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      await expect(
        mcpCallAction(
          {
            serverId: 'commerce',
            request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
          },
          baseContext,
        ),
      ).rejects.toThrow(/network error/)
    })

    it('throws on empty response body', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      await expect(
        mcpCallAction(
          {
            serverId: 'commerce',
            request: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
          },
          baseContext,
        ),
      ).rejects.toThrow(/empty response/)
    })
  })
})
