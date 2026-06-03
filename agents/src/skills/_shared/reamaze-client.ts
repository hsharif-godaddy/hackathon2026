/**
 * Shared Reamaze client — dispatches via ClientActionService.
 *
 * Architecture:
 *   agent tool → ClientActionService (socket) → browser → /api/inbox
 *   BFF route → Reamaze with user's auth_idp as `Authorization: sso-jwt <jwt>`
 *
 * No HTTP fetch happens here. No token machinery. No env vars. The agent
 * delegates to the browser so Reamaze sees the user's session (typ: "idp"
 * token) and authorizes based on customer_id → brand ownership.
 *
 * Reused across skills that need Reamaze account provisioning.
 */

import type { IClientActionService } from '../../services/ClientActionService.js';
import { Logger } from '../../logging/index.js';

const logger = Logger.create({ component: 'reamaze.client' });

// Must match CLIENT_ACTIONS.INBOX_CALL in
// app/src/hooks/websocket/actions/constants.ts — keep in sync manually.
const CLIENT_ACTION_NAME = 'inboxCall';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type ReamazeResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status?: number };

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

// ----------------------------------------------------------------------------
// Client-action dispatch
// ----------------------------------------------------------------------------

// Must match InboxOperation in app/src/app/api/inbox/route.ts — keep in sync manually.
type Operation =
  | 'list_accounts'
  | 'activate_account'
  | 'list_embeddables'
  | 'create_embeddable'
  | 'update_embeddable';

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

export async function dispatch<T>(
  client: IClientActionService,
  args: DispatchParams,
): Promise<ReamazeResult<T>> {
  const logCtx = { appId: args.appId, ...(args.brandId && { brandId: args.brandId }) };
  logger.info(`reamaze.client.${args.operation}.start`, logCtx);

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
    logger.error(`reamaze.client.${args.operation}.dispatch_failed`, {
      ...logCtx,
      error: message,
    });
    return { success: false, error: message };
  }

  if (!clientResult.success) {
    return { success: false, error: clientResult.error || 'client action failed' };
  }

  const bff = clientResult.result as BffResponse | undefined;
  if (!bff || typeof bff.status !== 'number') {
    logger.warn(`reamaze.client.${args.operation}.unexpected_shape`, {
      ...logCtx,
      result: JSON.stringify(bff)?.slice(0, 200),
    });
    return { success: false, error: 'BFF returned unexpected shape' };
  }

  if (bff.status < 200 || bff.status >= 300) {
    const errData = bff.data as { message?: string; error?: string; errors?: string[] } | undefined;
    const errorText =
      errData?.message ?? errData?.error ?? errData?.errors?.join('; ') ?? `HTTP ${bff.status}`;
    logger.warn(`reamaze.client.${args.operation}.error`, {
      ...logCtx,
      status: bff.status,
      error: errorText,
    });
    return { success: false, error: errorText, status: bff.status };
  }

  logger.info(`reamaze.client.${args.operation}.success`, logCtx);
  return { success: true, data: bff.data as T };
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

