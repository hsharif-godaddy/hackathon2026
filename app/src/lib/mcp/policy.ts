/**
 * MCP Proxy Policy
 *
 * Enforces per-request constraints on proxied MCP calls:
 *   - which JSON-RPC methods the proxy will forward
 *   - scope floor/ceiling resolution per request
 *   - blocked tool names
 *
 * The proxy route should treat this module as its single source of truth
 * for allow/deny decisions on agent-initiated MCP traffic.
 */

import type { McpServerConfig } from './servers'

/**
 * JSON-RPC methods the proxy will forward. Anything else is rejected
 * so that agent input cannot be used to call e.g. notifications/* or
 * server-only lifecycle methods.
 */
export const ALLOWED_MCP_METHODS = new Set([
  'tools/list',
  'tools/call',
])

/**
 * Core MCP tool names that agents discover/execute through. search_tools
 * requires no extra commerce scopes; execute_tool dispatches other tools
 * by name and must still pass their scope requirements.
 */
const CORE_DISCOVERY_TOOLS = new Set(['search_tools', 'execute_tool'])

export interface McpProxyRequestShape {
  jsonrpc: '2.0'
  method: string
  id?: number | string | null
  params?: {
    name?: string
    arguments?: Record<string, unknown>
    [key: string]: unknown
  }
}

export type PolicyDecision =
  | {
      allow: true
      /** Scopes the token-exchange layer should request for this specific call. */
      requestedScopes: readonly string[]
      /** Canonical outer tool name when method is tools/call, otherwise undefined. */
      toolName?: string
      /** Inner target tool for execute_tool dispatches, or the named tool for direct calls. */
      targetToolName?: string
    }
  | {
      allow: false
      status: number
      error: string
    }

/**
 * Shallow-validate an incoming JSON-RPC request from the browser bridge.
 * Returns a typed request on success or a PolicyDecision describing why
 * it was rejected.
 */
export type ParsedMcpRequest =
  | { ok: true; request: McpProxyRequestShape }
  | { ok: false; status: number; error: string }

export function parseMcpRequest(raw: unknown): ParsedMcpRequest {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 400, error: 'request body must be an object' }
  }

  const r = raw as Record<string, unknown>
  if (r.jsonrpc !== '2.0') {
    return { ok: false, status: 400, error: 'request.jsonrpc must be "2.0"' }
  }
  if (typeof r.method !== 'string' || r.method.length === 0) {
    return { ok: false, status: 400, error: 'request.method is required' }
  }
  if (
    r.params !== undefined &&
    (typeof r.params !== 'object' || r.params === null || Array.isArray(r.params))
  ) {
    return { ok: false, status: 400, error: 'request.params must be a non-array object when provided' }
  }

  return {
    ok: true,
    request: {
      jsonrpc: '2.0',
      method: r.method,
      id: (r.id as number | string | null | undefined) ?? null,
      params: (r.params as McpProxyRequestShape['params']) ?? undefined,
    },
  }
}

/**
 * Determine whether this MCP request is allowed for the given server,
 * and if so, which OAuth scopes the proxy should request.
 *
 * Scope strategy:
 *   - tools/list                     -> discoveryScopes
 *   - tools/call search_tools        -> discoveryScopes
 *   - tools/call execute_tool        -> full allowedScopes (ceiling)
 *       We do not know the inner tool's scopesRequired without another
 *       round-trip, so we grant the full ceiling for execute_tool
 *       dispatches. The MCP server still enforces per-tool scopes. The
 *       proxy still applies blockedTools to the inner execute_tool target.
 *   - tools/call <named tool>        -> full allowedScopes (ceiling)
 *       Same rationale; scope narrowing per tool is a follow-up.
 *
 * All denials return allow:false with a concrete HTTP status so the proxy
 * can surface them as JSON-RPC / HTTP errors uniformly.
 */
export function decideMcpPolicy(
  server: McpServerConfig,
  request: McpProxyRequestShape,
): PolicyDecision {
  if (!ALLOWED_MCP_METHODS.has(request.method)) {
    return {
      allow: false,
      status: 400,
      error: `method not allowed by policy: ${request.method}`,
    }
  }

  if (request.method === 'tools/list') {
    return { allow: true, requestedScopes: server.discoveryScopes }
  }

  // tools/call
  const toolName = request.params?.name
  if (typeof toolName !== 'string' || toolName.length === 0) {
    return {
      allow: false,
      status: 400,
      error: 'tools/call requires params.name',
    }
  }

  if (server.blockedTools?.includes(toolName)) {
    return {
      allow: false,
      status: 403,
      error: `tool is blocked by policy: ${toolName}`,
    }
  }

  if (toolName === 'search_tools') {
    return { allow: true, requestedScopes: server.discoveryScopes, toolName, targetToolName: toolName }
  }

  if (toolName === 'execute_tool') {
    const targetToolName = request.params?.arguments?.tool
    if (
      typeof targetToolName === 'string' &&
      server.blockedTools?.includes(targetToolName)
    ) {
      return {
        allow: false,
        status: 403,
        error: `tool is blocked by policy: ${targetToolName}`,
      }
    }

    return {
      allow: true,
      requestedScopes: server.allowedScopes,
      toolName,
      ...(typeof targetToolName === 'string' && targetToolName.length > 0
        ? { targetToolName }
        : {}),
    }
  }

  if (!CORE_DISCOVERY_TOOLS.has(toolName)) {
    return {
      allow: true,
      requestedScopes: server.allowedScopes,
      toolName,
      targetToolName: toolName,
    }
  }

  // unreachable given CORE_DISCOVERY_TOOLS contents, but exhaustive
  return {
    allow: false,
    status: 500,
    error: `unhandled tool: ${toolName}`,
  }
}

/**
 * Normalize a requested scope set into a stable cache key.
 * Deduplicates, lowercases, and sorts the scopes.
 */
export function normalizeScopeSet(scopes: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const s of scopes) {
    if (typeof s === 'string' && s.trim().length > 0) {
      unique.add(s.trim().toLowerCase())
    }
  }
  return [...unique].sort()
}
