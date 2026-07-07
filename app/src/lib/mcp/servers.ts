/**
 * MCP Server Registry
 *
 * Declares the MCP servers the AAB BFF proxy is allowed to reach.
 * New servers must be added here explicitly - the proxy does not accept
 * arbitrary URLs from agent input.
 *
 * URLs are derived from GODADDY_API_BASE_URL so dev/test/prod all work
 * without additional configuration.
 */

import { resolveGoDaddyApiBaseUrl } from './godaddy-api'

export interface McpServerConfig {
  /** Identifier used by agents / browser to select this server */
  id: string
  /** User-visible name for consent prompts and logs. */
  displayName: string
  /** Fully-resolved MCP endpoint (ends in /mcp) */
  url: string
  /** MCP protocol version to negotiate with this server. */
  protocolVersion: string
  /** Capabilities sent during initialize for this server. */
  initializeCapabilities: Record<string, unknown>
  /**
   * OAuth scope ceiling for this server. The proxy will never request
   * scopes outside this list, regardless of agent / client request.
   */
  allowedScopes: readonly string[]
  /**
   * Baseline scope set used for discovery (search_tools). search_tools
   * declares scopesRequired: [] on the commerce MCP server, but the
   * endpoint itself still requires an authenticated bearer token.
   */
  discoveryScopes: readonly string[]
  /**
   * Tool names that are always blocked, even if the scopes would permit them.
   * Useful when multiple tools share one broad scope.
   */
  blockedTools?: readonly string[]
}

/**
 * Derive the commerce MCP URL from GODADDY_API_BASE_URL.
 *
 *   https://api.dev-godaddy.com   ->  https://mcp.commerce.api.dev-godaddy.com/mcp
 *   https://api.test-godaddy.com  ->  https://mcp.commerce.api.test-godaddy.com/mcp
 *   https://api.godaddy.com       ->  https://mcp.commerce.api.godaddy.com/mcp
 */
export function resolveCommerceMcpUrl(): string {
  const override = process.env.COMMERCE_MCP_URL
  if (override) return override

  const apiBaseUrl = resolveGoDaddyApiBaseUrl()

  // Accept either protocol-prefixed or host-only base values.
  let host: string
  try {
    host = new URL(apiBaseUrl).host
  } catch {
    host = apiBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }

  // Prefix with 'mcp.commerce.' while keeping the environment suffix
  // (dev-godaddy.com / test-godaddy.com / godaddy.com) intact.
  return `https://mcp.commerce.${host}/mcp`
}

/**
 * Commerce MCP server configuration.
 *
 * Scope ceiling MUST be a subset of what the AiroBuilder OAuth client
 * is registered for. Mismatches cause `invalid_scope` at token exchange
 * (not at tool authorization). See:
 *   https://oauth.api.dev-godaddy.com (client app registration)
 *
 * Current AAB OAuth client scopes:
 *   - openid, email, profile
 *   - commerce.product:read, commerce.product:write
 *   - commerce.onboarding-application:read, commerce.onboarding-application:write
 *   - commerce.store:read
 *   - commerce.order:read
 *   - commerce.channel:read
 *   - apps.app-registry:write
 *
 * Not registered on the client (do NOT add here without updating the
 * client registration first):
 *   - commerce.store:create / commerce.store:write
 *   - commerce.order:write, commerce.transaction:*
 */
function buildCommerceServer(): McpServerConfig {
  return {
    id: 'commerce',
    displayName: 'GoDaddy Commerce',
    url: resolveCommerceMcpUrl(),
    protocolVersion: '2024-11-05',
    initializeCapabilities: {},
    allowedScopes: [
      'commerce.product:read',
      'commerce.product:write',
      'commerce.store:read',
      'commerce.onboarding-application:read',
      'commerce.onboarding-application:write',
      'commerce.order:read',
      'commerce.channel:read',
      'apps.app-registry:write',
    ] as const,
    // Minimal authenticated token for discovery. search_tools itself
    // declares scopesRequired: []; we only need something that the
    // OAuth server will mint and that JWKS-validates on the MCP side.
    discoveryScopes: ['openid'] as const,
  }
}

/**
 * Registry of allowed MCP servers, keyed by id.
 *
 * Built lazily so tests and local dev can change env vars without
 * tripping the resolveCommerceMcpUrl guard at module import time.
 */
let cachedRegistry: Record<string, McpServerConfig> | null = null

export function getMcpServerRegistry(): Record<string, McpServerConfig> {
  if (!cachedRegistry) {
    cachedRegistry = {
      commerce: buildCommerceServer(),
    }
  }
  return cachedRegistry
}

/**
 * Look up a server config by id. Returns undefined if the id is not
 * in the allowlist.
 */
export function getMcpServer(id: string): McpServerConfig | undefined {
  return getMcpServerRegistry()[id]
}

/**
 * Test-only helper to reset the cached registry (and re-read env vars).
 */
export function __resetMcpServerRegistryForTests(): void {
  cachedRegistry = null
}
