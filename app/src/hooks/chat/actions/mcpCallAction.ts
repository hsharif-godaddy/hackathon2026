/**
 * MCP Call Action Executor
 *
 * Same-origin browser bridge for agent-initiated MCP calls.
 *
 * The agent emits a `mcp_call` client action with:
 *   { serverId, request: { jsonrpc: '2.0', method, params, id } }
 *
 * The browser POSTs to /api/mcp/proxy (same-origin, authenticated via
 * existing AAB session). The BFF:
 *   - validates server allowlist + policy
 *   - exchanges the customer JWT for a scoped OAuth token
 *   - forwards the JSON-RPC request to the external MCP server
 *   - returns a normalized JSON-RPC response
 *
 * The raw auth_idp cookie is never forwarded to the external MCP server.
 */

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import type { ClientActionExecutor } from './types'

/**
 * Parameters emitted by the agent when dispatching `mcp_call`.
 *
 * We accept both the new same-origin shape and a legacy
 * `{ serverUrl, toolName, input }` shape so in-flight callers keep
 * working while the migration lands. Legacy calls are translated
 * into the new JSON-RPC shape before hitting the proxy.
 */
interface McpCallParamsV2 {
  serverId: string
  request: {
    jsonrpc: '2.0'
    method: string
    id?: number | string | null
    params?: {
      name?: string
      arguments?: Record<string, unknown>
      [key: string]: unknown
    }
  }
}

interface McpCallParamsLegacy {
  /** Legacy: full MCP server URL. Ignored — serverId is resolved on BFF. */
  serverUrl: string
  /** Legacy: MCP tool name. */
  toolName: string
  /** Legacy: tool arguments. */
  input?: Record<string, unknown>
  /**
   * Optional serverId hint for legacy callers. If omitted we default to
   * 'commerce' since that is the only configured MCP server today.
   */
  serverId?: string
}

interface McpJsonRpcMessage {
  jsonrpc: string
  id?: number | string | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

const PROXY_PATH = '/api/mcp/proxy'
const DEFAULT_SERVER_ID = 'commerce'

function normalizeParams(raw: unknown): McpCallParamsV2 | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'mcp_call: params must be an object' }
  }
  const p = raw as Record<string, unknown>

  if (p.serverId && p.request && typeof p.request === 'object') {
    if (typeof p.serverId !== 'string' || p.serverId.length === 0) {
      return { error: 'mcp_call: serverId must be a non-empty string' }
    }
    return { serverId: p.serverId, request: p.request as McpCallParamsV2['request'] }
  }

  // Legacy shape compatibility.
  const legacy = p as unknown as McpCallParamsLegacy
  if (typeof legacy.toolName === 'string' && legacy.toolName.length > 0) {
    if (legacy.serverId !== undefined && typeof legacy.serverId !== 'string') {
      return { error: 'mcp_call: legacy serverId must be a string when provided' }
    }
    return {
      serverId: legacy.serverId ?? DEFAULT_SERVER_ID,
      request: {
        jsonrpc: '2.0',
        method: 'tools/call',
        id: Date.now(),
        params: {
          name: legacy.toolName,
          arguments: legacy.input ?? {},
        },
      },
    }
  }

  return { error: 'mcp_call: expected { serverId, request } or legacy { toolName, input }' }
}

export const mcpCallAction: ClientActionExecutor = async (params, context) => {
  const normalized = normalizeParams(params)
  if ('error' in normalized) {
    throw new Error(normalized.error)
  }

  const { serverId, request } = normalized
  const toolName =
    request.method === 'tools/call' && typeof request.params?.name === 'string'
      ? request.params.name
      : undefined

  logger.info('mcp-call-action.start', {
    serverId,
    method: request.method,
    toolName,
    appId: context.currentAppId,
  })

  let response: Response
  try {
    response = await appFetch(
      PROXY_PATH,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ serverId, request, appId: context.currentAppId }),
      },
      { handle401: { level: 3 } },
    )
  } catch (err) {
    logger.error('mcp-call-action.network_error', {
      serverId,
      method: request.method,
      toolName,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new Error(
      `mcp_call network error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const text = await response.text()
  let parsed: McpJsonRpcMessage | { error?: string; status?: number } | null = null
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as McpJsonRpcMessage) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const message = buildProxyErrorMessage(parsed, response.status)
    logger.error('mcp-call-action.proxy_error', {
      serverId,
      method: request.method,
      toolName,
      status: response.status,
      message,
    })
    throw new Error(message)
  }

  if (!parsed || typeof parsed !== 'object') {
    logger.error('mcp-call-action.empty_response', {
      serverId,
      method: request.method,
      toolName,
      status: response.status,
    })
    throw new Error('mcp_call: empty response from proxy')
  }

  const rpc = parsed as McpJsonRpcMessage
  if (rpc.error) {
    logger.error('mcp-call-action.rpc_error', {
      serverId,
      method: request.method,
      toolName,
      errorCode: rpc.error.code,
      errorMessage: rpc.error.message,
    })
    throw new Error(`mcp_call error: ${rpc.error.message}`)
  }

  logger.info('mcp-call-action.success', {
    serverId,
    method: request.method,
    toolName,
  })

  return rpc.result
}

function buildProxyErrorMessage(
  parsed: McpJsonRpcMessage | { error?: string; message?: string; authReason?: number; status?: number } | null,
  status: number,
): string {
  if (parsed && typeof parsed === 'object') {
    const body = parsed as Record<string, unknown>
    const error = typeof body.error === 'string' ? body.error : undefined
    const message = typeof body.message === 'string' ? body.message : undefined
    const authReason = typeof body.authReason === 'number' ? body.authReason : undefined

    if (error && message) {
      return authReason !== undefined
        ? `${error}: ${message} (authReason=${authReason})`
        : `${error}: ${message}`
    }
    if (message) return message
    if (error) return error
  }

  return `mcp_call failed: HTTP ${status}`
}
