import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  __resetMcpServerRegistryForTests,
  getMcpServer,
  getMcpServerRegistry,
  resolveCommerceMcpUrl,
} from '../servers'

const ORIGINAL_ENV = { ...process.env }

describe('mcp servers registry', () => {
  beforeEach(() => {
    __resetMcpServerRegistryForTests()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    __resetMcpServerRegistryForTests()
    process.env = { ...ORIGINAL_ENV }
  })

  describe('resolveCommerceMcpUrl', () => {
    it('derives dev URL from GODADDY_API_BASE_URL', () => {
      process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com'
      delete process.env.COMMERCE_MCP_URL
      expect(resolveCommerceMcpUrl()).toBe('https://mcp.commerce.api.dev-godaddy.com/mcp')
    })

    it('derives test URL from GODADDY_API_BASE_URL', () => {
      process.env.GODADDY_API_BASE_URL = 'https://api.test-godaddy.com'
      delete process.env.COMMERCE_MCP_URL
      expect(resolveCommerceMcpUrl()).toBe('https://mcp.commerce.api.test-godaddy.com/mcp')
    })

    it('derives test URL from GATEWAY_BASE_URL when GODADDY_API_BASE_URL is omitted', () => {
      delete process.env.GODADDY_API_BASE_URL
      process.env.GATEWAY_BASE_URL = 'https://api.test-godaddy.com'
      delete process.env.COMMERCE_MCP_URL
      expect(resolveCommerceMcpUrl()).toBe('https://mcp.commerce.api.test-godaddy.com/mcp')
    })

    it('derives prod URL from GODADDY_API_BASE_URL', () => {
      process.env.GODADDY_API_BASE_URL = 'https://api.godaddy.com'
      delete process.env.COMMERCE_MCP_URL
      expect(resolveCommerceMcpUrl()).toBe('https://mcp.commerce.api.godaddy.com/mcp')
    })

    it('honors COMMERCE_MCP_URL override', () => {
      process.env.COMMERCE_MCP_URL = 'https://example.com/mcp'
      process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com'
      expect(resolveCommerceMcpUrl()).toBe('https://example.com/mcp')
    })

    it('derives from GoDaddy SSO URL when GODADDY_API_BASE_URL is omitted', () => {
      delete process.env.COMMERCE_MCP_URL
      delete process.env.GODADDY_API_BASE_URL
      delete process.env.GATEWAY_BASE_URL
      process.env.SSO_LOGIN_URL = 'https://sso.dev-godaddy.com/login'
      expect(resolveCommerceMcpUrl()).toBe('https://mcp.commerce.api.dev-godaddy.com/mcp')
    })

    it('derives test URL for Katana pre-test when GODADDY_API_BASE_URL is omitted', () => {
      delete process.env.COMMERCE_MCP_URL
      delete process.env.GODADDY_API_BASE_URL
      delete process.env.GATEWAY_BASE_URL
      delete process.env.SSO_LOGIN_URL
      delete process.env.SSO_LOGOUT_URL
      delete process.env.LOGIN_REDIRECT_URL
      delete process.env.LOGOUT_REDIRECT_URL
      delete process.env.NEXT_PUBLIC_APP_URL
      process.env.ENVIRONMENT_NAME = 'pre-test'
      expect(resolveCommerceMcpUrl()).toBe('https://mcp.commerce.api.test-godaddy.com/mcp')
    })

    it('throws when no API base URL can be inferred', () => {
      delete process.env.COMMERCE_MCP_URL
      delete process.env.GODADDY_API_BASE_URL
      delete process.env.GATEWAY_BASE_URL
      delete process.env.SSO_LOGIN_URL
      delete process.env.SSO_LOGOUT_URL
      delete process.env.LOGIN_REDIRECT_URL
      delete process.env.LOGOUT_REDIRECT_URL
      delete process.env.NEXT_PUBLIC_APP_URL
      delete process.env.GODADDY_ENVIRONMENT
      delete process.env.ENVIRONMENT_NAME
      delete process.env.KATANA_ENVIRONMENT
      process.env.NODE_ENV = 'test'
      expect(() => resolveCommerceMcpUrl()).toThrow(/GoDaddy API base URL/)
    })
  })

  describe('registry', () => {
    beforeEach(() => {
      process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com'
      delete process.env.COMMERCE_MCP_URL
    })

    it('returns commerce config from getMcpServer', () => {
      const server = getMcpServer('commerce')
      expect(server).toBeDefined()
      expect(server?.id).toBe('commerce')
      expect(server?.displayName).toBe('GoDaddy Commerce')
      expect(server?.url).toBe('https://mcp.commerce.api.dev-godaddy.com/mcp')
      expect(server?.protocolVersion).toBe('2025-11-25')
    })

    it('returns undefined for unknown server ids', () => {
      expect(getMcpServer('transactions')).toBeUndefined()
      expect(getMcpServer('')).toBeUndefined()
    })

    it('commerce allowedScopes covers the approved commerce and app-registry set', () => {
      const server = getMcpServer('commerce')!
      // Must match what the AAB OAuth client is registered for (see
      // servers.ts buildCommerceServer). Adding a scope here without
      // updating the client registration first will cause invalid_scope.
      expect(server.allowedScopes).toContain('commerce.product:read')
      expect(server.allowedScopes).toContain('commerce.product:write')
      expect(server.allowedScopes).toContain('commerce.store:read')
      expect(server.allowedScopes).toContain('commerce.order:read')
      expect(server.allowedScopes).toContain('commerce.channel:read')
      expect(server.allowedScopes).toContain('apps.app-registry:read')
      expect(server.allowedScopes).toContain('apps.app-registry:write')

      // Still not approved for AAB MCP proxy.
      expect(server.allowedScopes).not.toContain('commerce.store:create')
      expect(server.allowedScopes).not.toContain('commerce.store:write')
      expect(server.allowedScopes).not.toContain('commerce.order:write')
      expect(server.allowedScopes.some((s) => s.startsWith('commerce.transaction'))).toBe(false)
    })

    it('commerce discoveryScopes is minimal', () => {
      const server = getMcpServer('commerce')!
      expect(server.discoveryScopes).toEqual(['openid'])
    })

    it('commerce initialize capabilities are safe by default', () => {
      const server = getMcpServer('commerce')!
      expect(server.initializeCapabilities).toEqual({})
    })

    it('does not block store setup tools', () => {
      const server = getMcpServer('commerce')!
      expect(server.blockedTools ?? []).not.toContain('commerce_store_setup')
    })

    it('caches the registry across calls', () => {
      const a = getMcpServerRegistry()
      const b = getMcpServerRegistry()
      expect(a).toBe(b)
    })
  })
})
