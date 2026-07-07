/**
 * POST /api/mcp/proxy
 *
 * Same-origin BFF proxy for AAB -> external MCP servers.
 *
 *   Browser                        BFF                    External MCP
 *      |                            |                          |
 *      |-- POST /api/mcp/proxy ---->|                          |
 *      |   { serverId, request }    |-- JWT->OAuth exchange -->|
 *      |                            |-- POST /mcp + bearer --->|
 *      |<-- {result|error}  --------|<------- response --------|
 *
 * The AAB session cookie never leaves the BFF. The external MCP server
 * only receives the OAuth bearer token minted for this call.
 */

import { NextRequest, NextResponse } from 'next/server'

import {
  type CustomerAuthContext,
  withCustomerAuth,
} from '@/lib/customer-auth'
import {
  buildMcpInitializeCapabilities,
  resolveMcpElicitationEnabled,
  serverSupportsElicitation,
} from '@/lib/mcp/elicitation-gate'
import {
  decideMcpPolicy,
  normalizeScopeSet,
  parseMcpRequest,
} from '@/lib/mcp/policy'
import { getMcpServer } from '@/lib/mcp/servers'
import { McpUpstreamError, runWithMcpSession } from '@/lib/mcp/session'
import {
  exchangeCustomerJwtForOAuthToken,
  TokenExchangeError,
} from '@/lib/mcp/token-exchange'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

interface McpProxyBody {
  serverId?: unknown
  request?: unknown
  /** Optional app id supplied by the browser for audit logs and upstream request context. */
  appId?: unknown
}

export const POST = withCustomerAuth(
  async (req: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
    const { user, jwt } = authContext
    if (!jwt) {
      return NextResponse.json(
        { error: 'mcp_proxy: missing customer JWT' },
        { status: 401 },
      )
    }

    let body: McpProxyBody
    try {
      body = (await req.json()) as McpProxyBody
    } catch {
      return NextResponse.json(
        { error: 'mcp_proxy: invalid JSON body' },
        { status: 400 },
      )
    }

    if (typeof body.serverId !== 'string' || body.serverId.length === 0) {
      return NextResponse.json(
        { error: 'mcp_proxy: serverId is required' },
        { status: 400 },
      )
    }

    let server: ReturnType<typeof getMcpServer>
    try {
      server = getMcpServer(body.serverId)
    } catch (err) {
      if (isMcpProxyConfigurationError(err)) {
        logger.error('mcp.proxy.configuration_error', {
          serverId: body.serverId,
          message: err.message,
        })
        return NextResponse.json(
          { error: `mcp_proxy: configuration error: ${err.message}` },
          { status: 503 },
        )
      }
      throw err
    }

    if (!server) {
      return NextResponse.json(
        { error: `mcp_proxy: unknown serverId: ${body.serverId}` },
        { status: 400 },
      )
    }

    const appId = typeof body.appId === 'string' && body.appId.length > 0
      ? body.appId
      : undefined

    const parsed = parseMcpRequest(body.request)
    if (parsed.ok === false) {
      return NextResponse.json(
        { error: `mcp_proxy: ${parsed.error}` },
        { status: parsed.status },
      )
    }

    const decision = decideMcpPolicy(server, parsed.request)
    if (decision.allow === false) {
      logger.warn('mcp.proxy.policy.denied', {
        serverId: server.id,
        appId,
        method: parsed.request.method,
        toolName: parsed.request.params?.name,
        status: decision.status,
        reason: decision.error,
      })
      return NextResponse.json(
        { error: `mcp_proxy: ${decision.error}` },
        { status: decision.status },
      )
    }

    // Mint (or reuse) an OAuth token scoped to this request.
    let accessToken: string
    try {
      const token = await exchangeCustomerJwtForOAuthToken({
        customerJwt: jwt,
        customerId: user.customerId,
        serverId: server.id,
        scopes: decision.requestedScopes,
      })
      accessToken = token.accessToken
    } catch (err) {
      if (err instanceof TokenExchangeError) {
        logger.warn('mcp.proxy.token_exchange.failed', {
          serverId: server.id,
          appId,
          method: parsed.request.method,
          toolName: decision.toolName,
          targetToolName: decision.targetToolName,
          status: err.status,
          message: err.message,
        })
        return NextResponse.json(
          { error: `mcp_proxy: token exchange failed: ${err.message}` },
          { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
        )
      }
      if (isMcpProxyConfigurationError(err)) {
        logger.error('mcp.proxy.configuration_error', {
          serverId: server.id,
          appId,
          method: parsed.request.method,
          toolName: decision.toolName,
          targetToolName: decision.targetToolName,
          message: err.message,
        })
        return NextResponse.json(
          { error: `mcp_proxy: configuration error: ${err.message}` },
          { status: 503 },
        )
      }

      const message = err instanceof Error ? err.message : String(err)
      logger.error('mcp.proxy.token_exchange.unexpected_error', {
        serverId: server.id,
        appId,
        method: parsed.request.method,
        toolName: decision.toolName,
        targetToolName: decision.targetToolName,
        error: message,
      })
      return NextResponse.json(
        { error: `mcp_proxy: token exchange failed before response: ${message}` },
        { status: 502 },
      )
    }

    // MCP servers require a stateful session: initialize + notifications/initialized
    // before the real request. runWithMcpSession handles that lifecycle
    // plus load-balancer affinity cookies and session-invalid retries.
    const started = Date.now()
    const elicitationEnabled =
      serverSupportsElicitation(server) && (await resolveMcpElicitationEnabled(req, server.id))
    const initializeCapabilities = buildMcpInitializeCapabilities(
      server.initializeCapabilities,
      elicitationEnabled,
      server.protocolVersion,
    )
    let upstreamStatus: number
    let upstreamContentType: string
    let upstreamBody: string
    try {
      const upstream = await runWithMcpSession(
        {
          url: server.url,
          serverId: server.id,
          protocolVersion: server.protocolVersion,
          initializeCapabilities,
          customerId: user.customerId,
          accessToken,
          ...(appId ? { appId } : {}),
        },
        (client) => client.sendRaw(parsed.request),
      )
      upstreamStatus = upstream.status
      upstreamContentType = upstream.contentType
      upstreamBody = upstream.body
    } catch (err) {
      if (err instanceof McpUpstreamError) {
        logger.warn('mcp.proxy.upstream.mcp_error', {
          serverId: server.id,
          appId,
          customerId: user.customerId,
          method: parsed.request.method,
          toolName: decision.toolName,
          targetToolName: decision.targetToolName,
          status: err.status,
          detail: err.detail?.slice(0, 500),
        })
        return NextResponse.json(
          { error: `mcp_proxy: ${err.message}` },
          { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
        )
      }
      logger.error('mcp.proxy.upstream.network_error', {
        serverId: server.id,
        appId,
        method: parsed.request.method,
        toolName: decision.toolName,
        targetToolName: decision.targetToolName,
        error: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(
        { error: 'mcp_proxy: upstream network error' },
        { status: 502 },
      )
    }

    const latencyMs = Date.now() - started

    // On error responses, capture a snippet of the body so operators can
    // see the upstream reason without hand-tailing a proxy. Success bodies
    // are large (tool schemas) and not useful at info level.
    const upstreamErrorBody =
      upstreamStatus >= 400 ? upstreamBody.slice(0, 1000) : undefined

    logger.info('mcp.proxy.upstream.response', {
      serverId: server.id,
      appId,
      customerId: user.customerId,
      method: parsed.request.method,
      toolName: decision.toolName,
      targetToolName: decision.targetToolName,
      scopes: normalizeScopeSet(decision.requestedScopes),
      scopeCount: decision.requestedScopes.length,
      status: upstreamStatus,
      latencyMs,
      contentType: upstreamContentType,
      upstreamErrorBody,
    })

    // MCP servers using Streamable HTTP transport may respond with either
    // JSON or SSE. Normalize both into a single JSON-RPC message for the
    // browser bridge; the bridge does not need to stream for tools/call.
    const jsonRpc = normalizeUpstreamBody(upstreamBody, upstreamContentType)
    if (!jsonRpc) {
      return NextResponse.json(
        {
          error: 'mcp_proxy: upstream returned an unreadable response',
          status: upstreamStatus,
        },
        { status: 502 },
      )
    }

    // Forward upstream HTTP status so the browser/agent can distinguish
    // auth/scope errors from tool-level isError results. Success bodies
    // are always returned with HTTP 200 even if the JSON-RPC message
    // carries a tool-level error, matching MCP semantics.
    const outStatus =
      upstreamStatus >= 200 && upstreamStatus < 300 ? 200 : upstreamStatus
    return NextResponse.json(jsonRpc, { status: outStatus })
  },
  { level: 3 },
)

function isMcpProxyConfigurationError(err: unknown): err is Error {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('MCP token exchange requires') ||
    err.message.includes('Cannot resolve OAuth token endpoint') ||
    err.message.includes('Cannot resolve commerce MCP URL') ||
    err.message.includes('Cannot resolve GoDaddy API base URL')
  )
}

/**
 * MCP streamable HTTP responses may be:
 *   - application/json      -> single JSON-RPC message
 *   - text/event-stream     -> one or more SSE events, final message wins
 *
 * This normalizes both to the last JSON-RPC message in the stream.
 */
function normalizeUpstreamBody(text: string, contentType: string): unknown | null {
  if (text.length === 0) return null

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  if (contentType.includes('text/event-stream')) {
    let last: unknown | null = null
    for (const rawEvent of text.split(/\n\n+/)) {
      const dataLines: string[] = []
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
      if (dataLines.length === 0) continue
      const joined = dataLines.join('\n')
      try {
        last = JSON.parse(joined)
      } catch {
        // skip non-JSON data lines (e.g. keep-alives)
      }
    }
    return last
  }

  // Unknown content type — try JSON as a last-ditch attempt.
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
