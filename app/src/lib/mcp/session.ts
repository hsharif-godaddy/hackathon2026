/**
 * MCP Client Session
 *
 * Stateful MCP Streamable-HTTP protocol handling. Each call constructs a
 * fresh client, sends `initialize`, sends `notifications/initialized`,
 * and then performs the actual request. No cross-request session reuse.
 *
 * Why per-call sessions instead of caching:
 *   Deployed MCP servers are load-balanced and sessions live in the
 *   memory of a single instance. Without sticky routing the cached
 *   session id will 404 ("Session not found") on a different instance
 *   on the next call. The simplest correct answer is a fresh session
 *   per operation, combined with the load balancer's affinity cookie so
 *   the initialize + follow-up land on the same pod.
 *
 * This mirrors the pattern used by gdcorp-commerce/agent-demo
 * (src/lib/admin-mcp-client.ts), which talks to the same MCP server.
 */

import { logger } from '@/lib/request-context'

const DEFAULT_MCP_PROTOCOL_VERSION = '2024-11-05'

const MAX_RETRIES = 3

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponseEnvelope {
  jsonrpc?: '2.0'
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface McpClientOptions {
  /** MCP server /mcp endpoint. */
  url: string
  /** Stable server id (for logs only). */
  serverId: string
  /** MCP protocol version to negotiate with this server. */
  protocolVersion?: string
  /** Initialize capabilities for this server/session. */
  initializeCapabilities?: Record<string, unknown>
  /** Customer who owns this request (for logs / error context only). */
  customerId: string
  /** OAuth bearer token. */
  accessToken: string
  /** App/site id associated with this request. Forwarded as request context only. */
  appId?: string
}

/**
 * A single-use MCP client bound to one request/response exchange.
 * Not thread-safe — instantiate once per proxy call.
 */
export class McpClient {
  private readonly url: string
  private readonly serverId: string
  private readonly protocolVersion: string
  private readonly initializeCapabilities: Record<string, unknown>
  private readonly customerId: string
  private readonly accessToken: string
  private readonly appId: string | undefined
  private sessionId: string | null = null
  private sessionCookies: string | null = null
  private requestId = 0

  constructor(options: McpClientOptions) {
    this.url = options.url
    this.serverId = options.serverId
    this.protocolVersion = options.protocolVersion ?? DEFAULT_MCP_PROTOCOL_VERSION
    this.initializeCapabilities = options.initializeCapabilities ?? {}
    this.customerId = options.customerId
    this.accessToken = options.accessToken
    this.appId = options.appId
  }

  private nextRequestId(): number {
    return ++this.requestId
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.protocolVersion,
      Authorization: `Bearer ${this.accessToken}`,
    }
    if (this.appId) headers['X-Airo-App-Id'] = this.appId
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    if (this.sessionCookies) headers['Cookie'] = this.sessionCookies
    return headers
  }

  private captureSessionFromResponse(response: Response): void {
    const newSessionId = response.headers.get('Mcp-Session-Id')
    if (newSessionId) this.sessionId = newSessionId

    const setCookies = getSetCookieHeaders(response.headers)
    if (setCookies.length > 0) {
      this.sessionCookies = setCookiesToCookieHeader(setCookies, this.serverId)
    }
  }

  async initialize(): Promise<void> {
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextRequestId(),
      method: 'initialize',
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: this.initializeCapabilities,
        clientInfo: {
          name: 'airo-app-builder-bff',
          version: '1.0.0',
        },
      },
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    })

    this.captureSessionFromResponse(response)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new McpUpstreamError(
        `MCP initialize failed: ${response.status} ${response.statusText}`,
        response.status,
        text.slice(0, 1000),
      )
    }

    // Drain body so the connection can be reused.
    await response.text().catch(() => undefined)

    if (!this.sessionId) {
      throw new McpUpstreamError(
        'MCP initialize response did not include Mcp-Session-Id',
        502,
      )
    }

    // Some servers reject subsequent calls without this notification. Treat
    // failure as an incomplete initialization rather than continuing with a
    // half-initialized session and surfacing a less actionable downstream error.
    await this.sendNotification('notifications/initialized')
  }

  private async sendNotification(method: string): Promise<void> {
    const notif: JsonRpcNotification = { jsonrpc: '2.0', method }
    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(notif),
    })
    this.captureSessionFromResponse(response)
    const text = await response.text().catch(() => '')
    if (!response.ok && response.status !== 202) {
      throw new McpUpstreamError(
        `MCP notification ${method} failed: ${response.status} ${response.statusText}`,
        response.status,
        text.slice(0, 1000),
      )
    }
  }

  /**
   * Send an already-parsed JSON-RPC request (from the BFF caller) and
   * return the raw upstream HTTP response together with its body text
   * + content-type. Normalization (SSE vs JSON) is left to the caller
   * so the proxy route can log / forward untouched payloads.
   */
  async sendRaw(request: {
    jsonrpc: '2.0'
    id?: number | string | null
    method: string
    params?: Record<string, unknown>
  }): Promise<{ status: number; contentType: string; body: string }> {
    // Force a server-assigned id if the caller didn't provide one, so
    // error responses are attributable.
    const normalized: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: request.id ?? this.nextRequestId(),
      method: request.method,
      params: request.params,
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(normalized),
    })
    this.captureSessionFromResponse(response)

    const contentType = response.headers.get('content-type') ?? ''
    const body = await response.text()
    return { status: response.status, contentType, body }
  }
}

/**
 * Run `operation` against a fresh, initialized MCP client. Retries up to
 * 3 times on session-invalid errors (common with load-balanced servers).
 */
export async function runWithMcpSession<T>(
  options: McpClientOptions,
  operation: (client: McpClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new McpClient(options)
    try {
      await client.initialize()
      return await operation(client)
    } catch (err) {
      if (attempt < MAX_RETRIES && isSessionInvalidError(err)) {
        logger.info('mcp.session.retry', {
          serverId: options.serverId,
          customerId: options.customerId,
          attempt,
          reason: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      throw err
    }
  }
  throw new Error('MCP session retry loop exhausted without an error')
}

/**
 * Classifier for retry decisions. Matches the error signatures emitted
 * by the commerce MCP servers when a session is missing or expired.
 */
function isSessionInvalidError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  return (
    msg.includes('Session not found') ||
    msg.includes('Mcp-Session-Id header is required') ||
    msg.includes('Server not initialized')
  )
}

export class McpUpstreamError extends Error {
  readonly status: number
  readonly detail?: string
  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'McpUpstreamError'
    this.status = status
    this.detail = detail
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Read multiple Set-Cookie headers from a fetch Response. Node 18+
 * exposes `getSetCookie()`; fall back to the legacy single-value form.
 */
function getSetCookieHeaders(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetter.getSetCookie === 'function') {
    const all = withGetter.getSetCookie()
    if (all.length > 0) return all
  }
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

/**
 * Convert a list of Set-Cookie header values into a single Cookie
 * request header by taking each cookie's name=value pair. Matches the
 * approach used in gdcorp-commerce/agent-demo/src/lib/admin-mcp-client.ts.
 */
function setCookiesToCookieHeader(setCookieHeaders: string[], serverId: string): string {
  const entries: string[] = []
  for (const header of setCookieHeaders) {
    for (const cookie of header.split(/,(?=[^;,]+=)/g)) {
      const entry = cookie.split(';')[0]?.trim() ?? ''
      if (entry.length > 0) {
        entries.push(entry)
        continue
      }
      logger.warn('mcp.session.cookie_parse.dropped', {
        serverId,
        raw: header.slice(0, 200),
      })
    }
  }
  return entries.join('; ')
}

/** Test-only helpers. */
export function __resetMcpSessionModuleForTests(): void {
  // no-op placeholder — kept for symmetry with other mcp/* modules
}
