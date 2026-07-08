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

import type {
  ElicitInputRequest,
  ElicitResponses,
  InputRequiredResult,
} from '@airo/shared'

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { type PendingMcpElicitation, useMcpElicitationStore } from '@/stores/useMcpElicitationStore'
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
const MAX_ELICITATION_ROUNDS = 5

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

export const mcpCallAction: ClientActionExecutor = async (params, context, requestId) => {
  const normalized = normalizeParams(params)
  if ('error' in normalized) {
    throw new Error(normalized.error)
  }

  const { serverId, request } = normalized
  return runMcpCallWithElicitation(
    serverId,
    request,
    context.currentAppId,
    context.resetActionTimeout,
    requestId,
  )
}

async function runMcpCallWithElicitation(
  serverId: string,
  initialRequest: McpCallParamsV2['request'],
  appId: string,
  resetActionTimeout?: (requestId: string) => void,
  clientActionRequestId?: string,
): Promise<unknown> {
  let request = initialRequest

  for (let round = 0; round <= MAX_ELICITATION_ROUNDS; round++) {
    const rpc = await sendMcpProxyRequest(serverId, request, appId)

    if (rpc.error) {
      const toolName = getToolName(request)
      logger.error('mcp-call-action.rpc_error', {
        serverId,
        method: request.method,
        toolName,
        errorCode: rpc.error.code,
        errorMessage: rpc.error.message,
      })
      throw new Error(`mcp_call error: ${rpc.error.message}`)
    }

    const inputRequired = extractInputRequiredResult(rpc.result)
    if (!inputRequired) {
      logger.info('mcp-call-action.success', {
        serverId,
        method: request.method,
        toolName: getToolName(request),
        elicitationRounds: round,
      })
      return rpc.result
    }

    if (round === MAX_ELICITATION_ROUNDS) {
      throw new Error('mcp_call: exceeded maximum MCP elicitation rounds')
    }

    const inputResponses = await collectElicitationResponses({
      serverId,
      request,
      inputRequired,
      awaitingCompletion: round > 0,
      resetActionTimeout,
      clientActionRequestId,
    })
    request = buildContinuationRequest(request, inputRequired, inputResponses)
  }

  throw new Error('mcp_call: MCP elicitation loop exhausted without a result')
}

async function sendMcpProxyRequest(
  serverId: string,
  request: McpCallParamsV2['request'],
  appId: string,
): Promise<McpJsonRpcMessage> {
  const toolName =
    request.method === 'tools/call' && typeof request.params?.name === 'string'
      ? request.params.name
      : undefined

  logger.info('mcp-call-action.start', {
    serverId,
    method: request.method,
    toolName,
    appId,
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
        body: JSON.stringify({ serverId, request, appId }),
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
  return rpc
}

interface CollectElicitationResponsesOptions {
  serverId: string
  request: McpCallParamsV2['request']
  inputRequired: InputRequiredResult
  awaitingCompletion: boolean
  resetActionTimeout?: (requestId: string) => void
  clientActionRequestId?: string
}

async function collectElicitationResponses({
  serverId,
  request,
  inputRequired,
  awaitingCompletion,
  resetActionTimeout,
  clientActionRequestId,
}: CollectElicitationResponsesOptions): Promise<ElicitResponses> {
  const entries = Object.entries(inputRequired.inputRequests ?? {})
  if (entries.length === 0) {
    throw new Error('mcp_call: input_required result did not include inputRequests')
  }

  const inputResponses: ElicitResponses = {}
  for (const [id, inputRequest] of entries) {
    const pending = toPendingMcpElicitation({
      id,
      serverId,
      toolName: getToolName(request) ?? 'unknown',
      inputRequest,
      requestState: inputRequired.requestState,
      awaitingCompletion,
    })

    // The agent owns the timeout budget; ask it for a fresh window before waiting
    // on user input so the browser-side prompt does not exhaust the original call.
    if (clientActionRequestId) resetActionTimeout?.(clientActionRequestId)
    const result = await useMcpElicitationStore.getState().request(pending)
    inputResponses[id] = result
  }

  return inputResponses
}

function toPendingMcpElicitation({
  id,
  serverId,
  toolName,
  inputRequest,
  requestState,
  awaitingCompletion,
}: {
  id: string
  serverId: string
  toolName: string
  inputRequest: ElicitInputRequest
  requestState?: string
  awaitingCompletion: boolean
}): PendingMcpElicitation {
  if (!isElicitInputRequest(inputRequest)) {
    throw new Error(`mcp_call: invalid elicitation input request: ${id}`)
  }

  const { params } = inputRequest
  if (params.mode === 'url') {
    return {
      id,
      serverId,
      serverDisplayName: serverId,
      toolName,
      mode: 'url',
      message: params.message,
      url: params.url,
      requestState,
      awaitingCompletion,
    }
  }

  return {
    id,
    serverId,
    serverDisplayName: serverId,
    toolName,
    mode: 'form',
    message: params.message,
    requestedSchema: params.requestedSchema,
    requestState,
  }
}

function buildContinuationRequest(
  request: McpCallParamsV2['request'],
  inputRequired: InputRequiredResult,
  inputResponses: ElicitResponses,
): McpCallParamsV2['request'] {
  return {
    ...request,
    params: {
      ...(request.params ?? {}),
      inputResponses,
      ...(inputRequired.requestState ? { requestState: inputRequired.requestState } : {}),
    },
  }
}

function getToolName(request: McpCallParamsV2['request']): string | undefined {
  if (request.method !== 'tools/call' || typeof request.params?.name !== 'string') {
    return undefined
  }

  if (request.params.name === 'execute_tool') {
    const args = request.params.arguments
    if (isRecord(args) && typeof args.tool === 'string' && args.tool.length > 0) {
      return args.tool
    }
  }

  return request.params.name
}

function isInputRequiredResult(value: unknown): value is InputRequiredResult {
  return isRecord(value) && value.resultType === 'input_required'
}

function extractInputRequiredResult(value: unknown): InputRequiredResult | null {
  if (isInputRequiredResult(value)) return value

  // Commerce's `execute_tool` meta-tool returns target tool output through the
  // normal MCP ToolOutput envelope. The server then normalizes that to
  // `{ resultType: "complete", structuredContent: { data: <target result> } }`.
  // Treat a nested target `input_required` as the active elicitation while
  // preserving the outer `execute_tool` request for the continuation retry.
  if (isRecord(value)) {
    const structuredContent = value.structuredContent
    if (isRecord(structuredContent) && isInputRequiredResult(structuredContent.data)) {
      return structuredContent.data
    }
  }

  return null
}

function isElicitInputRequest(value: unknown): value is ElicitInputRequest {
  if (!isRecord(value) || value.method !== 'elicitation/create' || !isRecord(value.params)) {
    return false
  }

  const params = value.params
  if (typeof params.message !== 'string') return false

  if (params.mode === 'url') {
    return typeof params.url === 'string' && params.url.length > 0
  }

  return params.mode === undefined || params.mode === 'form'
    ? isRecord(params.requestedSchema)
    : false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
