/**
 * Shared inbox client — dispatches via ClientActionService.
 *
 * Architecture:
 *   agent tool → ClientActionService (socket) → browser → /api/inbox
 *   BFF route → Reamaze with user's auth_idp as `Authorization: sso-jwt <jwt>`
 *
 * No HTTP fetch happens here. No token machinery. No env vars. The agent
 * delegates to the browser so Reamaze sees the user's session (typ: "idp"
 * token) and authorizes based on customer_id → brand ownership.
 *
 * Reused across skills that need Inbox (Reamaze) account provisioning.
 */

import type { IClientActionService } from './ClientActionService.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'inbox.client' });

// Must match CLIENT_ACTIONS.INBOX_CALL in
// app/src/hooks/websocket/actions/constants.ts — keep in sync manually.
const CLIENT_ACTION_NAME = 'inboxCall';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type InboxResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status?: number };

export interface Account {
  name: string;
  accountUrl: string;
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
  | 'update_embeddable'
  | 'list_categories'
  | 'create_category'
  | 'get_staff'
  | 'update_staff';

interface DispatchParams {
  operation: Operation;
  appId: string;
  brandId?: string;
  embeddableId?: number;
  staffId?: number;
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
): Promise<InboxResult<T>> {
  const logCtx = { appId: args.appId, ...(args.brandId && { brandId: args.brandId }) };
  logger.info(`inbox.client.${args.operation}.start`, logCtx);

  let clientResult: Awaited<ReturnType<IClientActionService['executeAction']>>;
  try {
    clientResult = await client.executeAction({
      action: CLIENT_ACTION_NAME,
      params: {
        operation: args.operation,
        ...(args.brandId && { brandId: args.brandId }),
        ...(args.embeddableId !== undefined && { embeddableId: args.embeddableId }),
        ...(args.staffId !== undefined && { staffId: args.staffId }),
        ...(args.body !== undefined && { body: args.body }),
      },
      timeoutMs: 30_000,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`inbox.client.${args.operation}.dispatch_failed`, {
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
    logger.warn(`inbox.client.${args.operation}.unexpected_shape`, {
      ...logCtx,
      result: JSON.stringify(bff)?.slice(0, 200),
    });
    return { success: false, error: 'BFF returned unexpected shape' };
  }

  if (bff.status < 200 || bff.status >= 300) {
    const errData = bff.data as { message?: string; error?: string; errors?: string[] } | undefined;
    const errorText =
      errData?.message ?? errData?.error ?? errData?.errors?.join('; ') ?? `HTTP ${bff.status}`;
    logger.warn(`inbox.client.${args.operation}.error`, {
      ...logCtx,
      status: bff.status,
      error: errorText,
    });
    return { success: false, error: errorText, status: bff.status };
  }

  logger.info(`inbox.client.${args.operation}.success`, logCtx);
  return { success: true, data: bff.data as T };
}

// ----------------------------------------------------------------------------
// Account operations (not brand-scoped)
// ----------------------------------------------------------------------------

export async function listAccounts(
  client: IClientActionService,
  appId: string,
): Promise<InboxResult<ListAccountsResponse>> {
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
): Promise<InboxResult<Account>> {
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

// ----------------------------------------------------------------------------
// Category types
// ----------------------------------------------------------------------------

export interface Category {
  id: number;
  name: string;
  channel_type: number;
  status?: string;
  [key: string]: unknown;
}


// ----------------------------------------------------------------------------
// Embeddable types
// ----------------------------------------------------------------------------

export interface Embeddable {
  id: number;
  title?: string;
  [key: string]: unknown;
}

/** Fields we support sending to PUT /embeddables/{id}. Snake-cased per controller. */
export interface UpdateEmbeddableInput {
  title?: string;
  shoutbox_position?: string;
  shoutbox_bg?: string;
  shoutbox_icon?: string;
  shoutbox_label?: string;
  styles?: {
    button_bg_color?: string;
    header_bg_color?: string;
    button_font_color?: string;
    header_font_color?: string;
  };
}

// ----------------------------------------------------------------------------
// Embeddable operations (brand-scoped)
// ----------------------------------------------------------------------------

export async function listEmbeddables(
  client: IClientActionService,
  appId: string,
  brandId: string,
): Promise<InboxResult<Embeddable[]>> {
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
): Promise<InboxResult<Embeddable>> {
  const result = await dispatch<{ embeddable?: Embeddable } & Embeddable>(client, {
    operation: 'create_embeddable',
    appId,
    brandId,
    body: { embeddable: input },
  });
  if (!result.success) return result;
  const embeddable = result.data.embeddable ?? (result.data as Embeddable);
  if (typeof embeddable?.id !== 'number') {
    return { success: false, error: 'Inbox response missing embeddable.id' };
  }
  return { success: true, data: embeddable };
}

export async function updateEmbeddable(
  client: IClientActionService,
  appId: string,
  brandId: string,
  embeddableId: number,
  input: UpdateEmbeddableInput,
): Promise<InboxResult<Embeddable>> {
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
    return { success: false, error: 'Inbox response missing embeddable.id' };
  }
  return { success: true, data: embeddable };
}

// ----------------------------------------------------------------------------
// Category operations (brand-scoped)
// ----------------------------------------------------------------------------

export async function listCategories(
  client: IClientActionService,
  appId: string,
  brandId: string,
): Promise<InboxResult<Category[]>> {
  const result = await dispatch<{ categories?: Category[] }>(client, {
    operation: 'list_categories',
    appId,
    brandId,
  });
  if (!result.success) return result;
  return { success: true, data: result.data.categories ?? [] };
}

export async function createCategory(
  client: IClientActionService,
  appId: string,
  brandId: string,
  input: { name: string; channel_type: number },
): Promise<InboxResult<Category>> {
  const result = await dispatch<{ category?: Category } & Category>(client, {
    operation: 'create_category',
    appId,
    brandId,
    body: { category: input },
  });
  if (!result.success) return result;
  const category = result.data.category ?? (result.data as Category);
  if (typeof category?.id !== 'number') {
    return { success: false, error: 'Inbox response missing category.id' };
  }
  return { success: true, data: category };
}

// ----------------------------------------------------------------------------
// Staff types
// ----------------------------------------------------------------------------

export interface Staff {
  id: number;
  notification_email: string | null;
}

export interface UpdateStaffInput {
  notification_email?: string;
}

// ----------------------------------------------------------------------------
// Staff operations (brand-scoped)
// ----------------------------------------------------------------------------

export async function getStaff(
  client: IClientActionService,
  appId: string,
  brandId: string,
): Promise<InboxResult<Staff>> {
  const result = await dispatch<{ staff?: Staff } & Staff>(client, {
    operation: 'get_staff',
    appId,
    brandId,
  });
  if (!result.success) return result;
  const staff = result.data.staff ?? (result.data as Staff);
  if (typeof staff?.id !== 'number') {
    return { success: false, error: 'Inbox response missing staff.id' };
  }
  return { success: true, data: staff };
}

export async function updateStaff(
  client: IClientActionService,
  appId: string,
  brandId: string,
  staffId: number,
  fields: UpdateStaffInput,
): Promise<InboxResult<Staff>> {
  const result = await dispatch<{ staff?: Staff } & Staff>(client, {
    operation: 'update_staff',
    appId,
    brandId,
    staffId,
    body: fields,
  });
  if (!result.success) return result;
  const staff = result.data.staff ?? (result.data as Staff);
  if (typeof staff?.id !== 'number') {
    return { success: false, error: 'Inbox response missing staff.id' };
  }
  return { success: true, data: staff };
}

