import { describe, expect, it } from 'vitest'

import {
  decideMcpPolicy,
  normalizeScopeSet,
  parseMcpRequest,
} from '../policy'
import type { McpServerConfig } from '../servers'

const COMMERCE_SERVER: McpServerConfig = {
  id: 'commerce',
  displayName: 'GoDaddy Commerce',
  url: 'https://mcp.commerce.api.dev-godaddy.com/mcp',
  protocolVersion: '2024-11-05',
  initializeCapabilities: {},
  allowedScopes: [
    'commerce.product:read',
    'commerce.product:write',
    'commerce.store:read',
  ],
  discoveryScopes: ['openid'],
  blockedTools: ['dangerous_tool'],
}

describe('parseMcpRequest', () => {
  it('accepts a well-formed tools/call request', () => {
    const parsed = parseMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: { name: 'search_tools', arguments: { query: 'catalog' } },
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.request.method).toBe('tools/call')
      expect(parsed.request.params?.name).toBe('search_tools')
    }
  })

  it('accepts a tools/list request without params', () => {
    const parsed = parseMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    expect(parsed.ok).toBe(true)
  })

  it.each([
    ['non-object body', 'not-an-object'],
    ['wrong jsonrpc version', { jsonrpc: '1.0', method: 'tools/call' }],
    ['missing method', { jsonrpc: '2.0' }],
    ['non-string method', { jsonrpc: '2.0', method: 123 }],
    ['non-object params', { jsonrpc: '2.0', method: 'tools/call', params: 'oops' }],
    ['array params', { jsonrpc: '2.0', method: 'tools/list', params: [] }],
  ])('rejects %s', (_label, body) => {
    const parsed = parseMcpRequest(body) as { ok: false; status: number; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.status).toBe(400)
    expect(parsed.error).toBeTruthy()
  })
})

describe('decideMcpPolicy', () => {
  it('allows tools/list with discovery scopes', () => {
    const decision = decideMcpPolicy(COMMERCE_SERVER, {
      jsonrpc: '2.0',
      method: 'tools/list',
    })
    expect(decision.allow).toBe(true)
    if (decision.allow) {
      expect(decision.requestedScopes).toEqual(COMMERCE_SERVER.discoveryScopes)
    }
  })

  it('allows search_tools with discovery scopes', () => {
    const decision = decideMcpPolicy(COMMERCE_SERVER, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'search_tools', arguments: { query: 'foo' } },
    })
    expect(decision.allow).toBe(true)
    if (decision.allow) {
      expect(decision.requestedScopes).toEqual(COMMERCE_SERVER.discoveryScopes)
      expect(decision.toolName).toBe('search_tools')
      expect(decision.targetToolName).toBe('search_tools')
    }
  })

  it('allows execute_tool with full allowedScopes ceiling', () => {
    const decision = decideMcpPolicy(COMMERCE_SERVER, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'execute_tool', arguments: { tool: 'catalog_search' } },
    })
    expect(decision.allow).toBe(true)
    if (decision.allow) {
      expect(decision.requestedScopes).toEqual(COMMERCE_SERVER.allowedScopes)
      expect(decision.toolName).toBe('execute_tool')
      expect(decision.targetToolName).toBe('catalog_search')
    }
  })

  it('allows named tool call with ceiling scopes', () => {
    const decision = decideMcpPolicy(COMMERCE_SERVER, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'commerce_store_setup', arguments: {} },
    })
    expect(decision.allow).toBe(true)
    if (decision.allow) {
      expect(decision.requestedScopes).toEqual(COMMERCE_SERVER.allowedScopes)
      expect(decision.toolName).toBe('commerce_store_setup')
      expect(decision.targetToolName).toBe('commerce_store_setup')
    }
  })

  it('blocks tools listed in blockedTools', () => {
    const decision = decideMcpPolicy(COMMERCE_SERVER, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'dangerous_tool', arguments: {} },
    }) as { allow: false; status: number; error: string }
    expect(decision.allow).toBe(false)
    expect(decision.status).toBe(403)
    expect(decision.error).toMatch(/blocked/)
  })

  it('blocks execute_tool dispatches to tools listed in blockedTools', () => {
    const decision = decideMcpPolicy(COMMERCE_SERVER, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'execute_tool', arguments: { tool: 'dangerous_tool' } },
    }) as { allow: false; status: number; error: string }
    expect(decision.allow).toBe(false)
    expect(decision.status).toBe(403)
    expect(decision.error).toMatch(/dangerous_tool/)
  })

  it('rejects disallowed JSON-RPC methods', () => {
    const decision = decideMcpPolicy(COMMERCE_SERVER, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) as { allow: false; status: number; error: string }
    expect(decision.allow).toBe(false)
    expect(decision.status).toBe(400)
  })

  it('rejects tools/call without params.name', () => {
    const decision = decideMcpPolicy(COMMERCE_SERVER, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {},
    }) as { allow: false; status: number; error: string }
    expect(decision.allow).toBe(false)
    expect(decision.status).toBe(400)
  })
})

describe('normalizeScopeSet', () => {
  it('deduplicates, lowercases, and sorts', () => {
    expect(normalizeScopeSet(['Commerce.Store:Read', 'commerce.store:read', 'openid'])).toEqual([
      'commerce.store:read',
      'openid',
    ])
  })

  it('drops empty / non-string entries', () => {
    expect(normalizeScopeSet(['', 'openid', '   '])).toEqual(['openid'])
  })

  it('returns empty array when input is empty', () => {
    expect(normalizeScopeSet([])).toEqual([])
  })
})
