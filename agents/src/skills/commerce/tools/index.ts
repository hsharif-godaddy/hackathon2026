import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';

import { logger } from '../../../logging/index.js';
import { getActionService } from '../../../server/agent-runtime.js';

const COMMERCE_SERVER_ID = 'commerce';
// Browser/BFF MCP calls can include first-hit Next.js compilation, OAuth exchange,
// MCP initialize/affinity handshake, and a live Commerce upstream request. Keep
// this above the default client-action timeout so slow local/dev first calls do
// not resolve after the agent has already abandoned the request.
const DEFAULT_TIMEOUT_MS = 180_000;
const AIRO_CHANNEL_TYPE = 'ONLINE';
const AIRO_CHANNEL_SUB_TYPE = 'airo.ai.builder';
const AIRO_CHANNEL_SOURCE = 'airo-app-builder';
const AIRO_CHANNEL_NAME = 'Airo App Builder';
const AIRO_CHANNEL_PROVIDER_ID = '30373c02-3ab0-4f31-87e6-9c8e99ce83e2';

interface ClientActionContext {
  socketId?: unknown;
  metadata?: { appId?: unknown };
  appId?: unknown;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getArrayField(record: UnknownRecord, field: string): unknown[] | undefined {
  const value = record[field];
  return Array.isArray(value) ? value : undefined;
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
    return result;
  }

  const structured = result.structuredContent;
  const data = Object.prototype.hasOwnProperty.call(structured, 'data')
    ? structured.data
    : structured;
  const errors = getArrayField(structured, 'errors');
  const warnings = getArrayField(structured, 'warnings');
  const suggestedNext = getArrayField(structured, 'suggestedNext');
  const trace = getArrayField(structured, 'trace');
  const isError = result.isError === true || Boolean(errors?.length);

  if (!isError && !warnings?.length && !suggestedNext?.length) {
    return data;
  }

  return {
    ...(isError ? { isError: true } : {}),
    data,
    ...(errors?.length ? { errors } : {}),
    ...(warnings?.length ? { warnings } : {}),
    ...(suggestedNext?.length ? { suggestedNext } : {}),
    ...(trace?.length ? { trace } : {}),
    ...(Array.isArray(result.content) ? { content: result.content } : {}),
  };
}

function requireSocketId(context: unknown): string {
  const socketId = (context as ClientActionContext | undefined)?.socketId;
  if (typeof socketId !== 'string' || socketId.length === 0) {
    throw new Error(
      'commerce MCP tools require an active websocket session (no socketId in context)'
    );
  }
  return socketId;
}

function requireAppId(context: unknown): string {
  const typedContext = context as ClientActionContext | undefined;
  const appId = typedContext?.metadata?.appId ?? typedContext?.appId;
  if (typeof appId !== 'string' || appId.length === 0) {
    throw new Error('App ID required to bind the Airo App Builder channel');
  }
  return appId;
}

function getStringField(record: UnknownRecord, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function nestedRecord(record: UnknownRecord, field: string): UnknownRecord | undefined {
  const value = record[field];
  return isRecord(value) ? value : undefined;
}

interface AiroChannelValidation {
  valid: boolean;
  type?: string;
  subType?: string;
  appId?: string;
}

function validateAiroChannelResult(result: unknown, expectedAppId: string): AiroChannelValidation {
  if (!isRecord(result) || result.isError === true) {
    return { valid: false };
  }

  const channel =
    nestedRecord(result, 'channel') ??
    nestedRecord(result, 'salesChannel') ??
    nestedRecord(result, 'appChannel') ??
    result;
  const externalApp = nestedRecord(channel, 'externalApp') ?? nestedRecord(channel, 'external_app');
  const type = getStringField(channel, ['type', 'channelType']);
  const subType = getStringField(channel, ['subType', 'channelSubType']);
  const source = getStringField(channel, ['source', 'externalAppSource', 'external_app_source']);
  const registrationStatus = getStringField(channel, [
    'registrationStatus',
    'registration_status',
  ]);
  const appId =
    getStringField(channel, ['airo_app_id', 'airoAppId', 'externalAppId', 'external_app_id']) ??
    (externalApp ? getStringField(externalApp, ['id', 'appId']) : undefined);
  const isCommerceEnsureSummary =
    source === AIRO_CHANNEL_SOURCE &&
    appId === expectedAppId &&
    registrationStatus === 'ENABLED';
  const effectiveSubType =
    subType ?? (isCommerceEnsureSummary ? AIRO_CHANNEL_SUB_TYPE : undefined);

  return {
    type,
    subType: effectiveSubType,
    appId,
    valid:
      type === AIRO_CHANNEL_TYPE &&
      effectiveSubType === AIRO_CHANNEL_SUB_TYPE &&
      appId === expectedAppId,
  };
}

async function dispatchMcpCall(
  socketId: string,
  request: {
    method: 'tools/call';
    params: { name: string; arguments: Record<string, unknown> };
  },
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const svc = getActionService(socketId);
  if (!svc) {
    throw new Error(
      'commerce MCP tools require a client action service - websocket may have closed'
    );
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
  });

  if (!action.success) {
    throw new Error(action.error || 'commerce MCP call failed');
  }
  return action.result;
}

function formatToolError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logDispatchError(toolName: string, err: unknown): void {
  logger.warn('commerce_skill.tool.dispatch_error', {
    toolName,
    error: formatToolError(err),
  });
}

async function callCommerceMcpTool(
  context: unknown,
  toolName: string,
  argumentsObject: Record<string, unknown>
): Promise<unknown> {
  const socketId = requireSocketId(context);

  const result = await dispatchMcpCall(socketId, {
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: argumentsObject,
    },
  });
  return unwrapMcpToolResult(result);
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
        "Optional MCP category filter, such as 'catalog', 'orders', 'reporting', 'store', or 'meta'"
      ),
    includeCoreTools: z
      .boolean()
      .optional()
      .describe('Whether to include core tools in results. Defaults to the MCP server default.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    const socketId = requireSocketId(context);
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
      });
      return unwrapMcpToolResult(result);
    } catch (err) {
      logDispatchError('search_tools', err);
      return `commerce__search_tools error: ${formatToolError(err)}`;
    }
  },
};

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
    name: z.string().min(1).describe('The exact Commerce MCP tool name returned by search_tools'),
    arguments: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .describe(
        "Arguments object matching the tool's parameter schema. Prefer an object; a JSON-encoded string is accepted and parsed."
      ),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    const socketId = requireSocketId(context);
    let argumentsObject: Record<string, unknown> = {};
    if (typeof input.arguments === 'string') {
      try {
        const parsed = JSON.parse(input.arguments);
        if (!isRecord(parsed)) {
          return `commerce__execute_tool error: arguments string did not parse to a JSON object`;
        }
        argumentsObject = parsed;
      } catch (err) {
        return `commerce__execute_tool error: arguments string is not valid JSON: ${formatToolError(err)}`;
      }
    } else if (input.arguments) {
      argumentsObject = input.arguments;
    }

    if (input.name === 'commerce_app_channel_ensure') {
      return `commerce__execute_tool error: use commerce_store_channel_ensure for Airo App Builder channel setup`;
    }

    try {
      const result = await dispatchMcpCall(socketId, {
        method: 'tools/call',
        params: {
          name: 'execute_tool',
          arguments: {
            tool: input.name,
            arguments: argumentsObject,
          },
        },
      });
      return unwrapMcpToolResult(result);
    } catch (err) {
      logDispatchError('execute_tool', err);
      return `commerce__execute_tool error: ${formatToolError(err)}`;
    }
  },
};

export const commerceStoreSetupTool: SkillToolDefinition = {
  name: 'commerce_store_setup',
  description:
    "Set up a GoDaddy Commerce store for the authenticated customer. Discovers any existing store and, with the caller's consent, creates a new one. Returns the resulting storeId, channelId, default locationId, and Commerce Home dashboard links. If this returns a storeId, call commerce_store_channel_ensure next before treating the store as ready.",
  parameters: z.object({
    firstName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'First name of the store owner. Required for first-time store creation. Do not infer it from storeName.'
      ),
    lastName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Last name of the store owner. Required for first-time store creation. Do not infer it from storeName.'
      ),
    email: z
      .string()
      .trim()
      .email()
      .optional()
      .describe(
        'Email address of the store owner. Required for first-time store creation. Do not synthesize fallback addresses.'
      ),
    storeName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional store/business name to use when creating a new store.'),
    storePreference: z
      .enum(['existing', 'new'])
      .optional()
      .describe(
        '`existing` reuses the discovered store; `new` creates a new store. If omitted and an existing store is found, the tool returns storeChoiceRequired.'
      ),
    storeId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Optional existing Commerce store ID to link directly. Must belong to the authenticated customer.'
      ),
    storeUrl: z
      .string()
      .trim()
      .url()
      .optional()
      .describe(
        'Optional Commerce Home store URL. The tool extracts storeId from the URL and reuses that store directly.'
      ),
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
      return await callCommerceMcpTool(context, 'commerce_store_setup', input);
    } catch (err) {
      logDispatchError('commerce_store_setup', err);
      return `commerce__commerce_store_setup error: ${formatToolError(err)}`;
    }
  },
};

export const commerceStoreListTool: SkillToolDefinition = {
  name: 'commerce_store_list',
  description:
    "List every GoDaddy Commerce store the authenticated customer owns. Returns each store's storeId, displayName, owning business, and Commerce Home deep link. Use this when the caller does not yet know a storeId.",
  parameters: z.object({}),
  config: { timeout: 185_000 },
  async execute(_input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_list', {});
    } catch (err) {
      logDispatchError('commerce_store_list', err);
      return `commerce__commerce_store_list error: ${formatToolError(err)}`;
    }
  },
};

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
      return await callCommerceMcpTool(context, 'commerce_store_get', input);
    } catch (err) {
      logDispatchError('commerce_store_get', err);
      return `commerce__commerce_store_get error: ${formatToolError(err)}`;
    }
  },
};

export const commerceStoreChannelsGetTool: SkillToolDefinition = {
  name: 'commerce_store_channels_get',
  description:
    "List all sales channels registered to a GoDaddy Commerce store. Returns each channel's channelId, name, type, status, channelProviderId, whether it is the store default, and a top-level defaultChannelId when one exists.",
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
      return await callCommerceMcpTool(context, 'commerce_store_channels_get', input);
    } catch (err) {
      logDispatchError('commerce_store_channels_get', err);
      return `commerce__commerce_store_channels_get error: ${formatToolError(err)}`;
    }
  },
};

export const commerceStoreChannelEnsureTool: SkillToolDefinition = {
  name: 'commerce_store_channel_ensure',
  description:
    'Ensure the required Airo App Builder sales channel exists on a GoDaddy Commerce store. This tool sets trusted channel type, subtype, provider, and current app binding from runtime context; only storeId is required.',
  parameters: z.object({
    storeId: z.string().trim().min(1).describe('The Commerce store ID to ensure the channel on.'),
    channelName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'The Channel name for commerce dashboard display. Optional, defaults to "Airo App Builder"'
      ),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    try {
      const appId = requireAppId(context);
      const channelName = input.channelName ?? AIRO_CHANNEL_NAME;
      const result = await callCommerceMcpTool(context, 'commerce_app_channel_ensure', {
        storeId: input.storeId,
        channelType: AIRO_CHANNEL_TYPE,
        channelSubType: AIRO_CHANNEL_SUB_TYPE,
        channelName,

        // This is a fixed UUID that the Commerce MCP server recognizes as the Airo App Builder channel provider. Do not change this value.
        channelProviderId: AIRO_CHANNEL_PROVIDER_ID,
        externalApp: {
          id: appId,
          name: channelName,
          source: AIRO_CHANNEL_SOURCE,
        },
      });
      const validation = validateAiroChannelResult(result, appId);
      if (!validation.valid) {
        logger.warn('commerce_skill.tool.invalid_airo_channel', {
          storeId: input.storeId,
          type: validation.type,
          subType: validation.subType,
          expectedAppId: appId,
          actualAppId: validation.appId,
        });
        return `commerce__commerce_store_channel_ensure error: Commerce did not return a valid Airo App Builder channel for this app.`;
      }
      return result;
    } catch (err) {
      logDispatchError('commerce_store_channel_ensure', err);
      return `commerce__commerce_store_channel_ensure error: ${formatToolError(err)}`;
    }
  },
};

export const tools: SkillToolDefinition[] = [
  searchToolsTool,
  executeToolTool,
  commerceStoreSetupTool,
  commerceStoreListTool,
  commerceStoreGetTool,
  commerceStoreChannelsGetTool,
  commerceStoreChannelEnsureTool,
];
