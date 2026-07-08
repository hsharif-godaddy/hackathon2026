/**
 * POST /api/inbox
 *
 * BFF proxy for Reamaze operations including Inbox skill actions and Pusher auth.
 * Agents fires this via client-action (inboxAction.ts), and usePusher hook calls
 * it for Pusher authentication. Browser carries auth_idp; we forward the validated
 * JWT as `Authorization: sso-jwt <jwt>` to Reamaze, which treats it as an idp-type
 * token — Reamaze authorizes based on the user's customer_id against the target brand.
 * No cert / service identity involved.
 *
 * Request body:
 *   { operation: 'list_accounts' | 'activate_account' | 'list_embeddables' | 'create_embeddable' | 'update_embeddable' | 'list_categories' | 'create_category' | 'get_staff' | 'update_staff' | 'pusher_auth',
 *     brandId?: string,        // required for brand-scoped operations (embeddables, staff, pusher_auth)
 *     embeddableId?: number,   // required for update_embeddable
 *     staffId?: number,        // required for update_staff
 *     body?: unknown,          // required for create/update operations and pusher_auth ({ socket_id, channel_name })
 *   }
 *
 * Auth: level 1 (default). Reamaze authorizes based on customer_id.
 *
 * Response: the Reamaze JSON response plus { status } for the agent to inspect.
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { getReamazeHost, UUID_RE } from '@/lib/inbox/reamaze-host';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

type InboxOperation =
  | 'list_accounts'
  | 'activate_account'
  | 'update_account'
  | 'update_brand'
  | 'list_embeddables'
  | 'create_embeddable'
  | 'update_embeddable'
  | 'list_categories'
  | 'create_category'
  | 'get_staff'
  | 'update_staff'
  | 'pusher_auth';

interface InboxRequest {
  operation: InboxOperation;
  brandId?: string;
  embeddableId?: number;
  staffId?: number;
  body?: unknown;
}

const REAMAZE_HOST = getReamazeHost();
const REAMAZE_BFF_HOST = `api.${REAMAZE_HOST}`;

function resolveRequest(req: InboxRequest): { method: 'GET' | 'POST' | 'PUT'; path: string } | { error: string } {
  switch (req.operation) {
    case 'list_accounts':
      return { method: 'GET', path: '/accounts' };
    case 'activate_account':
      return { method: 'POST', path: '/activateAiroAppBuilderAccount' };
    case 'update_account': {
      const accountUrl = (req.body as { accountUrl?: string } | undefined)?.accountUrl;
      if (!accountUrl || !UUID_RE.test(accountUrl)) {
        return { error: 'body.accountUrl (UUID) is required for update_account' };
      }
      return { method: 'PUT', path: `/accounts/${accountUrl}` };
    }
    case 'update_brand':
      if (!req.brandId || !UUID_RE.test(req.brandId)) {
        return { error: 'brandId (UUID) is required for update_brand' };
      }
      return { method: 'PUT', path: `/brands/${req.brandId}` };
    case 'list_embeddables':
      return { method: 'GET', path: '/embeddables' };
    case 'create_embeddable':
      return { method: 'POST', path: '/embeddables' };
    case 'update_embeddable':
      if (typeof req.embeddableId !== 'number') {
        return { error: 'embeddableId (number) is required for update_embeddable' };
      }
      return { method: 'PUT', path: `/embeddables/${req.embeddableId}` };
    case 'list_categories':
      return { method: 'GET', path: '/categories' };
    case 'create_category':
      return { method: 'POST', path: '/categories' };
    case 'get_staff':
      return { method: 'GET', path: '/staff/self' };
    case 'update_staff':
      if (typeof req.staffId !== 'number') {
        return { error: 'staffId (number) is required for update_staff' };
      }
      return { method: 'PUT', path: `/staff/${req.staffId}` };
    case 'pusher_auth':
      return { method: 'POST', path: '/pusher_authentication/auth' };
    default:
      return { error: `Unknown operation: ${(req as { operation: string }).operation}` };
  }
}

const ACCOUNT_LEVEL_OPERATIONS: InboxOperation[] = ['list_accounts', 'activate_account'];

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json(
      { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null) as InboxRequest | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const isAccountLevel = ACCOUNT_LEVEL_OPERATIONS.includes(body.operation);
  if (!isAccountLevel && (!body.brandId || typeof body.brandId !== 'string')) {
    return NextResponse.json({ error: 'brandId (string) is required' }, { status: 400 });
  }

  if (!isAccountLevel && !UUID_RE.test(body.brandId!)) {
    return NextResponse.json({ error: 'brandId must be a valid UUID' }, { status: 400 });
  }

  const resolved = resolveRequest(body);
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  let url: string;
  if (isAccountLevel) {
    url = `https://${REAMAZE_BFF_HOST}/bff/${resolved.path.replace(/^\//, '')}`;
  } else {
    url = `https://${body.brandId}.${REAMAZE_HOST}/api/v2/${resolved.path.replace(/^\//, '')}`;
  }
  const upstreamBody = (body.operation === 'update_account' && body.body && typeof body.body === 'object')
    ? (() => { const { accountUrl: _, ...rest } = body.body as Record<string, unknown>; return rest; })()
    : body.body;
  const hasBody = resolved.method !== 'GET' && upstreamBody !== undefined;

  logger.info('inbox.bff.proxy.start', {
    operation: body.operation,
    brandId: body.brandId,
    method: resolved.method,
    path: resolved.path,
  });

  const upstream = await fetch(url, {
    method: resolved.method,
    headers: {
      Accept: 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
      ...(hasBody && { 'Content-Type': 'application/json' }),
    },
    ...(hasBody && { body: JSON.stringify(upstreamBody) }),
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.bff.proxy.exception', {
      operation: body.operation,
      brandId: body.brandId,
      url,
      method: resolved.method,
      error: e.message,
      errorName: e.name,
      errorCause: String((e as Error & { cause?: unknown }).cause ?? ''),
    });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 });
  }

  const rawText = await upstream.text().catch(() => '');
  let data: unknown = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      logger.warn('inbox.bff.proxy.non-json', {
        operation: body.operation,
        brandId: body.brandId,
        status: upstream.status,
        contentType: upstream.headers.get('content-type'),
        bodySnippet: rawText.slice(0, 500),
      });
      data = { raw: rawText.slice(0, 2000) };
    }
  }

  if (!upstream.ok) {
    const nowSeconds: number = Math.floor(Date.now() / 1000);
    logger.warn('inbox.bff.proxy.error', {
      operation: body.operation,
      brandId: body.brandId,
      status: upstream.status,
      path: resolved.path,
      upstreamBody: data ? JSON.stringify(data).slice(0, 1000) : null,
      tokenExp: authContext.user.exp,
      tokenHbi: authContext.user.hbi,
      tokenTTLSeconds: authContext.user.exp ? authContext.user.exp - nowSeconds : undefined,
      tokenAgeSeconds: authContext.user.iat ? nowSeconds - authContext.user.iat : undefined,
      isPersistent: authContext.user.isPersistent,
    });
  } else {
    logger.info('inbox.bff.proxy.success', {
      operation: body.operation,
      brandId: body.brandId,
      status: upstream.status,
    });
  }

  // Return upstream status + body verbatim so the agent tool can branch on it
  return NextResponse.json({ status: upstream.status, data }, { status: 200 });
});
