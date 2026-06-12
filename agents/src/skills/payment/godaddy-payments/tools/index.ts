import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';

import { logger } from '../../../../logging/index.js';
import { getActionService } from '../../../../server/agent-runtime.js';

const COMMERCE_SERVER_ID = 'commerce';
// GoDaddy Payments setup crosses the same browser/BFF Commerce MCP bridge as
// Commerce store setup. First calls can include OAuth, MCP initialization, and
// upstream provisioning work, so keep this above the default tool timeout.
const DEFAULT_TIMEOUT_MS = 180_000;
const AIRO_CHANNEL_TYPE = 'ONLINE';
const AIRO_CHANNEL_SUB_TYPE = 'airo.ai.builder';
const AIRO_CHANNEL_SOURCE = 'airo-app-builder';
const AIRO_CHANNEL_NAME = 'Airo App Builder';
const AIRO_CHANNEL_PROVIDER_ID = '30373c02-3ab0-4f31-87e6-9c8e99ce83e2';
const PAYMENT_TEMPLATE_INSTALL_ACTION =
  "skill({ action: 'install', skill: 'payment/godaddy-payments' })";

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
 * Return structuredContent.data on the happy path, while preserving MCP
 * error/warning metadata when present.
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
      'GoDaddy Payments tools require an active websocket session (no socketId in context)'
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
      'GoDaddy Payments tools require a client action service - websocket may have closed'
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
    throw new Error(action.error || 'GoDaddy Payments MCP call failed');
  }
  return action.result;
}

function formatToolError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logDispatchError(toolName: string, err: unknown): void {
  logger.warn('godaddy_payments_skill.tool.dispatch_error', {
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

export const setupTool: SkillToolDefinition = {
  name: 'setup',
  description:
    "Set up GoDaddy Payments for this app by discovering or creating the customer's GoDaddy Commerce store. Returns the resulting storeId, channelId, default locationId, payment setup status, and Commerce Home dashboard links. If this returns a storeId, call godaddy-payments__store_channel_ensure next before treating GoDaddy Payments as ready.",
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
    businessId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'GoDaddy business ID to scope store discovery to a specific business. Pass this after the user has chosen a business from a businessChoiceRequired response.'
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
      logDispatchError('setup', err);
      return `godaddy-payments__setup error: ${formatToolError(err)}`;
    }
  },
};

export const storeListTool: SkillToolDefinition = {
  name: 'store_list',
  description:
    "List every GoDaddy Commerce store that can back GoDaddy Payments for the authenticated customer. Returns each store's storeId, displayName, owning business, and Commerce Home deep link. Use this when the caller does not yet know a storeId.",
  parameters: z.object({}),
  config: { timeout: 185_000 },
  async execute(_input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_list', {});
    } catch (err) {
      logDispatchError('store_list', err);
      return `godaddy-payments__store_list error: ${formatToolError(err)}`;
    }
  },
};

export const storeGetTool: SkillToolDefinition = {
  name: 'store_get',
  description:
    'Get metadata for a single GoDaddy Commerce store that can back GoDaddy Payments. Returns storeId, displayName, owning business, and Commerce Home dashboard links.',
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
      logDispatchError('store_get', err);
      return `godaddy-payments__store_get error: ${formatToolError(err)}`;
    }
  },
};

export const storeChannelsGetTool: SkillToolDefinition = {
  name: 'store_channels_get',
  description:
    "List all sales channels registered to a GoDaddy Commerce store. Use this for debugging GoDaddy Payments routing. Returns each channel's channelId, name, type, status, channelProviderId, whether it is the store default, and a top-level defaultChannelId when one exists.",
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
      logDispatchError('store_channels_get', err);
      return `godaddy-payments__store_channels_get error: ${formatToolError(err)}`;
    }
  },
};

export const storeChannelEnsureTool: SkillToolDefinition = {
  name: 'store_channel_ensure',
  description:
    `Ensure the required Airo App Builder sales channel exists on the GoDaddy Commerce store used by GoDaddy Payments. This tool sets trusted channel type, subtype, provider, and current app binding from runtime context; only storeId is required. After this tool succeeds, write the GoDaddy Commerce env vars and immediately call ${PAYMENT_TEMPLATE_INSTALL_ACTION} before writing payment UI or server code.`,
  parameters: z.object({
    storeId: z.string().trim().min(1).describe('The Commerce store ID to ensure the channel on.'),
    channelName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'The channel name for Commerce dashboard display. Optional, defaults to "Airo App Builder".'
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
        logger.warn('godaddy_payments_skill.tool.invalid_airo_channel', {
          storeId: input.storeId,
          type: validation.type,
          subType: validation.subType,
          expectedAppId: appId,
          actualAppId: validation.appId,
        });
        return `godaddy-payments__store_channel_ensure error: Commerce did not return a valid Airo App Builder channel for this app.`;
      }
      const ensuredChannel = isRecord(result) ? result : {};
      return {
        ...ensuredChannel,
        paymentSetupReady: true,
        NEXT_STEP:
          `Write VITE_GODADDY_STORE_ID, VITE_GODADDY_CHANNEL_ID, GODADDY_API_BASE_URL, and VITE_GODADDY_CURRENCY_CODE from the setup/channel results, then call ${PAYMENT_TEMPLATE_INSTALL_ACTION} before writing any payment UI or server code. Do not create checkout or order-status routes manually.`,
        requiredNextActions: [
          'Write VITE_GODADDY_STORE_ID from the resolved GoDaddy Commerce store ID.',
          'Write VITE_GODADDY_CHANNEL_ID from this ensured Airo App Builder channel.',
          'Write GODADDY_API_BASE_URL from the agents runtime and VITE_GODADDY_CURRENCY_CODE from setup or the store default.',
          `Call ${PAYMENT_TEMPLATE_INSTALL_ACTION} before creating payment UI, checkout buttons, success pages, or server handlers.`,
          'After install, call the installed /api/commerce/checkout and /api/commerce/order-status routes or import the installed server helpers.',
        ],
        forbiddenActions: [
          'Do not create src/server/api/commerce/checkout/POST.ts manually.',
          'Do not create src/server/api/commerce/order-status/GET.ts manually.',
          'Do not hand-roll Commerce checkout session helpers.',
          'Do not implement payment UI against missing env vars or uninstalled templates.',
        ],
      };
    } catch (err) {
      logDispatchError('store_channel_ensure', err);
      return `godaddy-payments__store_channel_ensure error: ${formatToolError(err)}`;
    }
  },
};

export const tools: SkillToolDefinition[] = [
  setupTool,
  storeListTool,
  storeGetTool,
  storeChannelsGetTool,
  storeChannelEnsureTool,
];
