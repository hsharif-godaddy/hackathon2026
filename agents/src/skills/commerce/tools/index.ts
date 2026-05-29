import { z } from 'zod'
import type { SkillToolDefinition } from '@airo/ai-skills'

import { logger } from '../../../logging/index.js'
import { getActionService } from '../../../server/agent-runtime.js'

const COMMERCE_SERVER_ID = 'commerce'
// Browser/BFF MCP calls can include first-hit Next.js compilation, OAuth exchange,
// MCP initialize/affinity handshake, and a live Commerce upstream request. Keep
// this above the default client-action timeout so slow local/dev first calls do
// not resolve after the agent has already abandoned the request.
const DEFAULT_TIMEOUT_MS = 180_000

interface ClientActionContext {
  socketId?: unknown
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getArrayField(record: UnknownRecord, field: string): unknown[] | undefined {
  const value = record[field]
  return Array.isArray(value) ? value : undefined
}

/**
 * MCP tool calls return a CallToolResult envelope:
 *   { content, structuredContent: { data, errors, warnings, trace } }
 *
 * The model needs MCP-authored tool descriptions and parameter schemas directly,
 * especially for search_tools. Return structuredContent.data on the happy path,
 * while preserving MCP error/warning metadata when present.
 */
function unwrapMcpToolResult(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.structuredContent)) {
    return result
  }

  const structured = result.structuredContent
  const data = Object.prototype.hasOwnProperty.call(structured, 'data')
    ? structured.data
    : structured
  const errors = getArrayField(structured, 'errors')
  const warnings = getArrayField(structured, 'warnings')
  const suggestedNext = getArrayField(structured, 'suggestedNext')
  const trace = getArrayField(structured, 'trace')
  const isError = result.isError === true || Boolean(errors?.length)

  if (!isError && !warnings?.length && !suggestedNext?.length) {
    return data
  }

  return {
    ...(isError ? { isError: true } : {}),
    data,
    ...(errors?.length ? { errors } : {}),
    ...(warnings?.length ? { warnings } : {}),
    ...(suggestedNext?.length ? { suggestedNext } : {}),
    ...(trace?.length ? { trace } : {}),
    ...(Array.isArray(result.content) ? { content: result.content } : {}),
  }
}

function requireSocketId(context: unknown): string {
  const socketId = (context as ClientActionContext | undefined)?.socketId
  if (typeof socketId !== 'string' || socketId.length === 0) {
    throw new Error(
      'commerce MCP tools require an active websocket session (no socketId in context)',
    )
  }
  return socketId
}

async function dispatchMcpCall(
  socketId: string,
  request: {
    method: 'tools/call'
    params: { name: string; arguments: Record<string, unknown> }
  },
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const svc = getActionService(socketId)
  if (!svc) {
    throw new Error(
      'commerce MCP tools require a client action service - websocket may have closed',
    )
  }

  const action = await svc.executeAction({
    action: 'mcp_call',
    params: {
      serverId: COMMERCE_SERVER_ID,
      request: {
        jsonrpc: '2.0',
        id: Date.now(),
        ...request,
      },
    },
    timeoutMs,
  })

  if (!action.success) {
    throw new Error(action.error || 'commerce MCP call failed')
  }
  return action.result
}

function formatToolError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function logDispatchError(toolName: string, err: unknown): void {
  logger.warn('commerce_skill.tool.dispatch_error', {
    toolName,
    error: formatToolError(err),
  })
}

async function callCommerceMcpTool(
  context: unknown,
  toolName: string,
  argumentsObject: Record<string, unknown>,
): Promise<unknown> {
  const socketId = requireSocketId(context)
  const result = await dispatchMcpCall(socketId, {
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: argumentsObject,
    },
  })
  return unwrapMcpToolResult(result)
}

export const searchToolsTool: SkillToolDefinition = {
  name: 'search_tools',
  description: `Search the GoDaddy Commerce MCP server for tools matching a natural-language query.

WHEN TO USE:
- Before calling execute_tool, to find the right Commerce MCP tool name and parameters
- When the user asks a commerce question and you don't already know which MCP tool to call
- When you need to inspect a Commerce tool's parameter schema or required scopes

WORKFLOW:
1. Call search_tools with a short query describing the task ("create a product", "list orders for a store", "enable payments")
2. Inspect the returned tools. Each tool description and parameter schema comes from the Commerce MCP server.
3. Choose one and call execute_tool with its name and arguments

RETURNS:
- { tools, relatedTools, query, totalFound }
- Each item in tools has: name, description, parameters (JSON schema), scopesRequired, category

NOTES:
- This only returns candidate tools; it does not execute anything
- Authentication happens automatically through the AAB browser/BFF bridge
- No extra commerce scopes are required for discovery itself`,
  parameters: z.object({
    query: z
      .string()
      .min(1)
      .max(500)
      .describe('Natural-language description of the task you want to accomplish'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum number of tools to return, 1-20 (default: server-controlled)'),
    category: z
      .string()
      .optional()
      .describe(
        "Optional MCP category filter, such as 'catalog', 'orders', 'reporting', 'store', or 'meta'",
      ),
    includeCoreTools: z
      .boolean()
      .optional()
      .describe('Whether to include core tools in results. Defaults to the MCP server default.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    const socketId = requireSocketId(context)
    try {
      const result = await dispatchMcpCall(socketId, {
        method: 'tools/call',
        params: {
          name: 'search_tools',
          arguments: {
            query: input.query,
            ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
            ...(typeof input.category === 'string' && input.category.length > 0
              ? { category: input.category }
              : {}),
            ...(typeof input.includeCoreTools === 'boolean'
              ? { includeCoreTools: input.includeCoreTools }
              : {}),
          },
        },
      })
      return unwrapMcpToolResult(result)
    } catch (err) {
      logDispatchError('search_tools', err)
      return `commerce__search_tools error: ${formatToolError(err)}`
    }
  },
}

export const executeToolTool: SkillToolDefinition = {
  name: 'execute_tool',
  description: `Execute a GoDaddy Commerce MCP tool by name.

WHEN TO USE:
- After search_tools has returned a matching tool
- When you already know the exact Commerce MCP tool name and argument shape

WORKFLOW:
1. Pass the tool name from search_tools as 'name'
2. Pass the argument object matching the tool's parameter JSON schema as 'arguments'
3. The returned value is the MCP tool's structured data. MCP errors include isError/errors/content.

IMPORTANT:
- Do not call execute_tool or search_tools recursively through this tool
- If the call fails with an auth / scope error, surface it to the user; do not retry blindly
- Destructive or sensitive tools (create/update/delete) require user confirmation first when appropriate`,
  parameters: z.object({
    name: z
      .string()
      .min(1)
      .describe('The exact Commerce MCP tool name returned by search_tools'),
    arguments: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Arguments object matching the tool's parameter schema"),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    const socketId = requireSocketId(context)
    try {
      const result = await dispatchMcpCall(socketId, {
        method: 'tools/call',
        params: {
          name: 'execute_tool',
          arguments: {
            tool: input.name,
            arguments: input.arguments ?? {},
          },
        },
      })
      return unwrapMcpToolResult(result)
    } catch (err) {
      logDispatchError('execute_tool', err)
      return `commerce__execute_tool error: ${formatToolError(err)}`
    }
  },
}

export const commerceStoreSetupTool: SkillToolDefinition = {
  name: 'commerce_store_setup',
  description:
    'Set up a GoDaddy Commerce store for the authenticated customer. Discovers any existing store and, with the caller\'s consent, creates a new one. Returns the resulting storeId, channelId, default locationId, and Commerce Home dashboard links. If an existing store is found and no storePreference is provided, returns storeChoiceRequired so the user can choose which store to use.',
  parameters: z.object({
    firstName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('First name of the store owner. Required for first-time store creation. Do not infer it from storeName.'),
    lastName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Last name of the store owner. Required for first-time store creation. Do not infer it from storeName.'),
    email: z
      .string()
      .trim()
      .email()
      .optional()
      .describe('Email address of the store owner. Required for first-time store creation. Do not synthesize fallback addresses.'),
    storeName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional store/business name to use when creating a new store.'),
    storePreference: z
      .enum(['existing', 'new'])
      .optional()
      .describe('`existing` reuses the discovered store; `new` creates a new store. If omitted and an existing store is found, the tool returns storeChoiceRequired.'),
    storeId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional existing Commerce store ID to link directly. Must belong to the authenticated customer.'),
    storeUrl: z
      .string()
      .trim()
      .url()
      .optional()
      .describe('Optional Commerce Home store URL. The tool extracts storeId from the URL and reuses that store directly.'),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe('Optional client-provided key for correlating safe retries of write tool calls.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_setup', input)
    } catch (err) {
      logDispatchError('commerce_store_setup', err)
      return `commerce__commerce_store_setup error: ${formatToolError(err)}`
    }
  },
}

export const commerceStoreListTool: SkillToolDefinition = {
  name: 'commerce_store_list',
  description:
    'List every GoDaddy Commerce store the authenticated customer owns. Returns each store\'s storeId, displayName, owning business, and Commerce Home deep link. Use this when the caller does not yet know a storeId.',
  parameters: z.object({}),
  config: { timeout: 185_000 },
  async execute(_input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_list', {})
    } catch (err) {
      logDispatchError('commerce_store_list', err)
      return `commerce__commerce_store_list error: ${formatToolError(err)}`
    }
  },
}

export const commerceStoreGetTool: SkillToolDefinition = {
  name: 'commerce_store_get',
  description:
    'Get metadata for a single GoDaddy Commerce store the authenticated customer owns. Returns storeId, displayName, owning business, and Commerce Home dashboard links.',
  parameters: z.object({
    storeId: z
      .string()
      .trim()
      .min(1)
      .describe('The Commerce store ID to fetch. Must belong to the authenticated customer.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_get', input)
    } catch (err) {
      logDispatchError('commerce_store_get', err)
      return `commerce__commerce_store_get error: ${formatToolError(err)}`
    }
  },
}

export const commerceStoreChannelsGetTool: SkillToolDefinition = {
  name: 'commerce_store_channels_get',
  description:
    'List all sales channels registered to a GoDaddy Commerce store. Returns each channel\'s channelId, name, type, status, channelProviderId, whether it is the store default, and a top-level defaultChannelId when one exists.',
  parameters: z.object({
    storeId: z
      .string()
      .trim()
      .min(1)
      .describe('The Commerce store ID whose channels should be listed.'),
    defaultOnly: z
      .boolean()
      .optional()
      .describe('When true, return only the channel flagged as default for this store.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_channels_get', input)
    } catch (err) {
      logDispatchError('commerce_store_channels_get', err)
      return `commerce__commerce_store_channels_get error: ${formatToolError(err)}`
    }
  },
}

export const tools: SkillToolDefinition[] = [
  searchToolsTool,
  executeToolTool,
  commerceStoreSetupTool,
  commerceStoreListTool,
  commerceStoreGetTool,
  commerceStoreChannelsGetTool,
]
