import { getActionService } from '../../server/agent-runtime.js';

const COMMERCE_SERVER_ID = 'commerce';
const DEFAULT_TIMEOUT_MS = 180_000;

export type UnknownRecord = Record<string, unknown>;

export interface ClientActionContext {
  socketId?: unknown;
  metadata?: { appId?: unknown };
  appId?: unknown;
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getArrayField(record: UnknownRecord, field: string): unknown[] | undefined {
  const value = record[field];
  return Array.isArray(value) ? value : undefined;
}

export function getStringField(record: UnknownRecord, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function nestedRecord(record: UnknownRecord, field: string): UnknownRecord | undefined {
  const value = record[field];
  return isRecord(value) ? value : undefined;
}

export function getAppId(context: unknown): string | undefined {
  const typedContext = context as ClientActionContext | undefined;
  const appId = typedContext?.metadata?.appId ?? typedContext?.appId;
  return typeof appId === 'string' && appId.length > 0 ? appId : undefined;
}

export function requireAppId(context: unknown): string {
  const appId = getAppId(context);
  if (!appId) {
    throw new Error('App ID required to bind the Airo App Builder channel');
  }
  return appId;
}

export function requireSocketId(context: unknown): string {
  const socketId = (context as ClientActionContext | undefined)?.socketId;
  if (typeof socketId !== 'string' || socketId.length === 0) {
    throw new Error('commerce MCP tools require an active websocket session (no socketId in context)');
  }
  return socketId;
}

export function unwrapMcpToolResult(result: unknown): unknown {
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

export function extractMcpErrorStatusCode(result: unknown): number | undefined {
  if (!isRecord(result)) return undefined;
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const first = isRecord(errors[0]) ? errors[0] : undefined;
  if (!first) return undefined;
  const metadata = isRecord(first.metadata) ? first.metadata : undefined;
  const data = isRecord(metadata?.data) ? metadata.data : undefined;
  return typeof data?.statusCode === 'number' ? data.statusCode : undefined;
}

export function formatToolError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function dispatchCommerceMcpCall(
  socketId: string,
  request: {
    method: 'tools/call';
    params: { name: string; arguments: Record<string, unknown> };
  },
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const svc = getActionService(socketId);
  if (!svc) {
    throw new Error('commerce MCP tools require a client action service - websocket may have closed');
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

export async function callCommerceMcpTool(
  context: unknown,
  toolName: string,
  argumentsObject: Record<string, unknown>
): Promise<unknown> {
  const socketId = requireSocketId(context);
  const result = await dispatchCommerceMcpCall(socketId, {
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: argumentsObject,
    },
  });
  return unwrapMcpToolResult(result);
}
