/**
 * Reamaze (Conversations) client — dispatches via ClientActionService.
 *
 * Architecture:
 *   agent tool → ClientActionService (socket) → browser → /api/conversations
 *   BFF route → Reamaze with user's auth_idp as `Authorization: sso-jwt <jwt>`
 *
 * No HTTP fetch happens here. No token machinery. No env vars. The agent
 * delegates to the browser so Reamaze sees the user's session (typ: "idp"
 * token) and authorizes based on customer_id → brand ownership.
 *
 * Scope: the Reamaze brand has already been provisioned for this site.
 * This module only manages embeddables (list/create/update).
 */

import type { IClientActionService } from '../../../services/ClientActionService.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.create({ component: 'conversations.reamaze' });

// Must match CLIENT_ACTIONS.CONVERSATIONS_CALL in
// app/src/hooks/websocket/actions/constants.ts — keep in sync manually.
// If this ever moves to @airo/shared, import from there on both sides.
const CLIENT_ACTION_NAME = 'conversationsCall';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type ReamazeResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status?: number };

export interface Embeddable {
  id: number;
  title?: string;
  [key: string]: unknown;
}

export interface Account {
  name: string;
  brandUrl: string;
  ventureId: string;
  aabAppId: string | null;
}

export interface UnlinkedEntitlement {
  entitlementId: string;
  name: string;
  plan: string;
  createdAt: string;
}

export interface ListAccountsResponse {
  accounts: Account[];
  unlinkedEntitlements: UnlinkedEntitlement[];
}

/** Fields we support sending to PUT /embeddables/{id}. Snake-cased per controller. */
export interface UpdateEmbeddableInput {
  title?: string;
  shoutbox_position?: string;
  shoutbox_bg?: string;
  shoutbox_icon?: string;
  styles?: {
    button_bg_color?: string;
    header_bg_color?: string;
    button_font_color?: string;
    header_font_color?: string;
  };
}

// ----------------------------------------------------------------------------
// Client-action dispatch
// ----------------------------------------------------------------------------

// Must match ConversationsOperation in app/src/app/api/conversations/route.ts — keep in sync manually.
type Operation = 'list_accounts' | 'activate_account' | 'list_embeddables' | 'create_embeddable' | 'update_embeddable';

interface DispatchParams {
  operation: Operation;
  appId: string;
  brandId?: string;
  embeddableId?: number;
  body?: unknown;
}

/** BFF response shape: { status, data } */
interface BffResponse {
  status: number;
  data: unknown;
}

async function dispatch<T>(
  client: IClientActionService,
  args: DispatchParams,
): Promise<ReamazeResult<T>> {
  const logCtx = { appId: args.appId, ...(args.brandId && { brandId: args.brandId }) };
  logger.info(`conversations.reamaze.${args.operation}.start`, logCtx);

  let clientResult: Awaited<ReturnType<IClientActionService['executeAction']>>;
  try {
    clientResult = await client.executeAction({
      action: CLIENT_ACTION_NAME,
      params: {
        operation: args.operation,
        ...(args.brandId && { brandId: args.brandId }),
        ...(args.embeddableId !== undefined && { embeddableId: args.embeddableId }),
        ...(args.body !== undefined && { body: args.body }),
      },
      timeoutMs: 30_000,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`conversations.reamaze.${args.operation}.dispatch_failed`, {
      ...logCtx,
      error: message,
    });
    return { success: false, error: message };
  }

  if (!clientResult.success) {
    return { success: false, error: clientResult.error || 'client action failed' };
  }

  // `result` is whatever conversationsAction returned — shape: { status, data }
  const bff = clientResult.result as BffResponse | undefined;
  if (!bff || typeof bff.status !== 'number') {
    logger.warn(`conversations.reamaze.${args.operation}.unexpected_shape`, {
      ...logCtx,
      result: JSON.stringify(bff)?.slice(0, 200),
    });
    return { success: false, error: 'BFF returned unexpected shape' };
  }

  if (bff.status < 200 || bff.status >= 300) {
    const errData = bff.data as { message?: string; error?: string; errors?: string[] } | undefined;
    const errorText =
      errData?.message ?? errData?.error ?? errData?.errors?.join('; ') ?? `HTTP ${bff.status}`;
    logger.warn(`conversations.reamaze.${args.operation}.error`, {
      ...logCtx,
      status: bff.status,
      error: errorText,
    });
    return { success: false, error: errorText, status: bff.status };
  }

  logger.info(`conversations.reamaze.${args.operation}.success`, logCtx);
  return { success: true, data: bff.data as T };
}

// ----------------------------------------------------------------------------
// Embeddable operations
// ----------------------------------------------------------------------------

export async function listEmbeddables(
  client: IClientActionService,
  appId: string,
  brandId: string,
): Promise<ReamazeResult<Embeddable[]>> {
  const result = await dispatch<{ embeddables?: Embeddable[] }>(client, {
    operation: 'list_embeddables',
    appId,
    brandId,
  });
  if (!result.success) return result;
  return { success: true, data: result.data.embeddables ?? [] };
}

export async function createEmbeddable(
  client: IClientActionService,
  appId: string,
  brandId: string,
  input: UpdateEmbeddableInput,
): Promise<ReamazeResult<Embeddable>> {
  const result = await dispatch<{ embeddable?: Embeddable } & Embeddable>(client, {
    operation: 'create_embeddable',
    appId,
    brandId,
    body: { embeddable: input },
  });
  if (!result.success) return result;
  const embeddable = result.data.embeddable ?? (result.data as Embeddable);
  if (typeof embeddable?.id !== 'number') {
    return { success: false, error: 'Reamaze response missing embeddable.id' };
  }
  return { success: true, data: embeddable };
}

export async function updateEmbeddable(
  client: IClientActionService,
  appId: string,
  brandId: string,
  embeddableId: number,
  input: UpdateEmbeddableInput,
): Promise<ReamazeResult<Embeddable>> {
  const result = await dispatch<{ embeddable?: Embeddable } & Embeddable>(client, {
    operation: 'update_embeddable',
    appId,
    brandId,
    embeddableId,
    body: { embeddable: input },
  });
  if (!result.success) return result;
  const embeddable = result.data.embeddable ?? (result.data as Embeddable);
  if (typeof embeddable?.id !== 'number') {
    return { success: false, error: 'Reamaze response missing embeddable.id' };
  }
  return { success: true, data: embeddable };
}

// ----------------------------------------------------------------------------
// Account operations (not brand-scoped)
// ----------------------------------------------------------------------------

export async function listAccounts(
  client: IClientActionService,
  appId: string,
): Promise<ReamazeResult<ListAccountsResponse>> {
  const result = await dispatch<ListAccountsResponse>(client, {
    operation: 'list_accounts',
    appId,
  });
  if (!result.success) return result;
  return {
    success: true,
    data: {
      accounts: result.data.accounts ?? [],
      unlinkedEntitlements: result.data.unlinkedEntitlements ?? [],
    },
  };
}

export async function activateAccount(
  client: IClientActionService,
  appId: string,
  entitlementId?: string,
  appName?: string,
): Promise<ReamazeResult<Account>> {
  return dispatch<Account>(client, {
    operation: 'activate_account',
    appId,
    body: {
      aabAppId: appId,
      ...(entitlementId && { aabEntitlementId: entitlementId }),
      ...(appName && { aabAppName: appName }),
    },
  });
}
