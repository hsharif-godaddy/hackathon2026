/**
 * MCP Call Action Tests
 *
 * Covers the same-origin BFF bridge behavior:
 *   - new { serverId, request } shape
 *   - legacy { serverUrl, toolName, input } shape (translated)
 *   - result normalization + error surfacing
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMcpElicitationStore } from '@/stores/useMcpElicitationStore'
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
    useMcpElicitationStore.setState({ pending: null, resolve: null })
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

  describe('MCP elicitation continuations', () => {
    it('publishes a form elicitation, waits for accept, and retries with inputResponses', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockProxyResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {
              resultType: 'input_required',
              requestState: 'state-1',
              inputRequests: {
                taxRate: {
                  method: 'elicitation/create',
                  params: {
                    message: 'Confirm tax rate',
                    requestedSchema: {
                      type: 'object',
                      properties: {
                        rate: { type: 'number', title: 'Rate' },
                      },
                      required: ['rate'],
                    },
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockProxyResponse({ jsonrpc: '2.0', id: 1, result: { saved: true } }),
        )

      const resetActionTimeout = vi.fn()
      const resultPromise = mcpCallAction(
        {
          serverId: 'commerce',
          request: {
            jsonrpc: '2.0',
            method: 'tools/call',
            id: 1,
            params: { name: 'configure_tax', arguments: { country: 'US' } },
          },
        },
        { ...baseContext, resetActionTimeout },
        'client-action-1',
      )

      const pending = await waitForPendingElicitation()
      expect(pending).toMatchObject({
        id: 'taxRate',
        serverId: 'commerce',
        serverDisplayName: 'commerce',
        toolName: 'configure_tax',
        mode: 'form',
        message: 'Confirm tax rate',
        requestState: 'state-1',
      })
      expect(pending.requestedSchema?.properties.rate).toEqual({ type: 'number', title: 'Rate' })
      expect(resetActionTimeout).toHaveBeenCalledWith('client-action-1')

      useMcpElicitationStore.getState().respond({ action: 'accept', content: { rate: 8.25 } })

      await expect(resultPromise).resolves.toEqual({ saved: true })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      const continuationInit = fetchSpy.mock.calls[1]![1] as RequestInit
      const continuationBody = JSON.parse(continuationInit.body as string) as {
        request: {
          params: {
            name: string
            arguments: Record<string, unknown>
            requestState: string
            inputResponses: Record<string, unknown>
          }
        }
      }
      expect(continuationBody.request.params).toMatchObject({
        name: 'configure_tax',
        arguments: { country: 'US' },
        requestState: 'state-1',
        inputResponses: {
          taxRate: { action: 'accept', content: { rate: 8.25 } },
        },
      })
    })

    it('sends decline responses back through the continuation request', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockProxyResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {
              resultType: 'input_required',
              inputRequests: {
                settings: {
                  method: 'elicitation/create',
                  params: {
                    message: 'Optional settings',
                    requestedSchema: { type: 'object', properties: {} },
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockProxyResponse({ jsonrpc: '2.0', id: 1, result: { skipped: true } }),
        )

      const resultPromise = mcpCallAction(
        {
          serverId: 'commerce',
          request: {
            jsonrpc: '2.0',
            method: 'tools/call',
            id: 1,
            params: { name: 'configure_settings', arguments: {} },
          },
        },
        baseContext,
      )

      await waitForPendingElicitation()
      useMcpElicitationStore.getState().respond({ action: 'decline' })

      await expect(resultPromise).resolves.toEqual({ skipped: true })
      const continuationInit = fetchSpy.mock.calls[1]![1] as RequestInit
      const continuationBody = JSON.parse(continuationInit.body as string) as {
        request: { params: { inputResponses: Record<string, unknown> } }
      }
      expect(continuationBody.request.params.inputResponses).toEqual({
        settings: { action: 'decline' },
      })
    })

    it('handles input_required returned through an execute_tool structuredContent envelope', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockProxyResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {
              resultType: 'complete',
              content: [{ type: 'text', text: 'Executed commerce_app_settings_configure.' }],
              structuredContent: {
                data: {
                  resultType: 'input_required',
                  inputRequests: {
                    commerce_app_settings: {
                      method: 'elicitation/create',
                      params: {
                        mode: 'form',
                        message: 'Configure Commerce Tax',
                        requestedSchema: {
                          type: 'object',
                          properties: {
                            manualTaxRatePercentage: { type: 'number', title: 'Tax rate' },
                          },
                          required: ['manualTaxRatePercentage'],
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockProxyResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {
              resultType: 'complete',
              structuredContent: { data: { status: 'configured' } },
            },
          }),
        )

      const resultPromise = mcpCallAction(
        {
          serverId: 'commerce',
          request: {
            jsonrpc: '2.0',
            method: 'tools/call',
            id: 1,
            params: {
              name: 'execute_tool',
              arguments: {
                tool: 'commerce_app_settings_configure',
                arguments: {
                  entityType: 'store',
                  entityId: 'store_123',
                  applicationName: 'wes-aab-manual-tax',
                },
              },
            },
          },
        },
        baseContext,
      )

      const pending = await waitForPendingElicitation()
      expect(pending).toMatchObject({
        id: 'commerce_app_settings',
        serverId: 'commerce',
        toolName: 'commerce_app_settings_configure',
        mode: 'form',
        message: 'Configure Commerce Tax',
      })

      useMcpElicitationStore.getState().respond({
        action: 'accept',
        content: { manualTaxRatePercentage: 8.25 },
      })

      await expect(resultPromise).resolves.toEqual({
        resultType: 'complete',
        structuredContent: { data: { status: 'configured' } },
      })
      const continuationInit = fetchSpy.mock.calls[1]![1] as RequestInit
      const continuationBody = JSON.parse(continuationInit.body as string) as {
        request: {
          params: {
            name: string
            arguments: Record<string, unknown>
            inputResponses: Record<string, unknown>
          }
        }
      }
      expect(continuationBody.request.params.name).toBe('execute_tool')
      expect(continuationBody.request.params.arguments).toMatchObject({
        tool: 'commerce_app_settings_configure',
      })
      expect(continuationBody.request.params.inputResponses).toEqual({
        commerce_app_settings: {
          action: 'accept',
          content: { manualTaxRatePercentage: 8.25 },
        },
      })
    })

    it('marks repeated URL elicitation requests as awaiting completion', async () => {
      const urlInputRequired = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          resultType: 'input_required',
          inputRequests: {
            connect: {
              method: 'elicitation/create',
              params: {
                mode: 'url',
                message: 'Connect account',
                url: 'https://example.com/oauth',
              },
            },
          },
        },
      }

      fetchSpy
        .mockResolvedValueOnce(mockProxyResponse(urlInputRequired))
        .mockResolvedValueOnce(mockProxyResponse(urlInputRequired))
        .mockResolvedValueOnce(
          mockProxyResponse({ jsonrpc: '2.0', id: 1, result: { connected: true } }),
        )

      const resultPromise = mcpCallAction(
        {
          serverId: 'commerce',
          request: {
            jsonrpc: '2.0',
            method: 'tools/call',
            id: 1,
            params: { name: 'connect_account', arguments: {} },
          },
        },
        baseContext,
      )

      const firstPending = await waitForPendingElicitation()
      expect(firstPending).toMatchObject({
        mode: 'url',
        url: 'https://example.com/oauth',
        awaitingCompletion: false,
      })
      useMcpElicitationStore.getState().respond({ action: 'accept' })

      const secondPending = await waitForPendingElicitation()
      expect(secondPending).toMatchObject({
        mode: 'url',
        url: 'https://example.com/oauth',
        awaitingCompletion: true,
      })
      useMcpElicitationStore.getState().respond({ action: 'accept' })

      await expect(resultPromise).resolves.toEqual({ connected: true })
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it('rejects malformed input_required responses without hanging the client action', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockProxyResponse({
          jsonrpc: '2.0',
          id: 1,
          result: { resultType: 'input_required' },
        }),
      )

      await expect(
        mcpCallAction(
          {
            serverId: 'commerce',
            request: {
              jsonrpc: '2.0',
              method: 'tools/call',
              id: 1,
              params: { name: 'configure_settings', arguments: {} },
            },
          },
          baseContext,
        ),
      ).rejects.toThrow(/did not include inputRequests/)
      expect(useMcpElicitationStore.getState().pending).toBeNull()
    })
  })
})

async function waitForPendingElicitation() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pending = useMcpElicitationStore.getState().pending
    if (pending) return pending
    await Promise.resolve()
  }
  throw new Error('Timed out waiting for pending MCP elicitation')
}
