/**
 * POST /api/conversations
 *
 * BFF proxy for the Conversations (Reamaze) skill. Agents fires this via a
 * client-action (conversationsAction.ts) so the call originates in the user's
 * browser, carrying auth_idp. We then forward the validated JWT as
 * `Authorization: sso-jwt <jwt>` to Reamaze, which treats it as an idp-type
 * token — Reamaze authorizes based on the user's customer_id against the
 * target brand. No cert / service identity involved.
 *
 * Request body:
 *   { operation: 'list_accounts' | 'activate_account' | 'list_embeddables' | 'create_embeddable' | 'update_embeddable',
 *     brandId?: string,        // required for brand-scoped operations (embeddables)
 *     embeddableId?: number,   // required for update_embeddable
 *     body?: unknown,          // required for create/update operations
 *   }
 *
 * Auth: level 3 (modifies external billing-linked state in Reamaze).
 *
 * Response: the Reamaze JSON response plus { status } for the agent to inspect.
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

type ConversationsOperation =
  | 'list_accounts'
  | 'activate_account'
  | 'list_embeddables'
  | 'create_embeddable'
  | 'update_embeddable';

interface ConversationsRequest {
  operation: ConversationsOperation;
  brandId?: string;
  embeddableId?: number;
  body?: unknown;
}

function reamazeHost(requestHost: string): string {
  if (requestHost.includes('dev-godaddy.com') || requestHost.includes('localhost')) {
    return 'reamaze.dev-godaddy.com';
  }
  if (requestHost.includes('test-godaddy.com')) {
    return 'reamaze.test-godaddy.com';
  }
  return 'reamaze.godaddy.com';
}

function reamazeBffHost(requestHost: string): string {
  if (requestHost.includes('dev-godaddy.com') || requestHost.includes('localhost')) {
    return 'api.reamaze.dev-godaddy.com';
  }
  if (requestHost.includes('test-godaddy.com')) {
    return 'api.reamaze.test-godaddy.com';
  }
  return 'api.reamaze.godaddy.com';
}

function resolveRequest(req: ConversationsRequest): { method: 'GET' | 'POST' | 'PUT'; path: string } | { error: string } {
  switch (req.operation) {
    case 'list_accounts':
      return { method: 'GET', path: '/accounts' };
    case 'activate_account':
      return { method: 'POST', path: '/activateAiroAppBuilderAccount' };
    case 'list_embeddables':
      return { method: 'GET', path: '/embeddables' };
    case 'create_embeddable':
      return { method: 'POST', path: '/embeddables' };
    case 'update_embeddable':
      if (typeof req.embeddableId !== 'number') {
        return { error: 'embeddableId (number) is required for update_embeddable' };
      }
      return { method: 'PUT', path: `/embeddables/${req.embeddableId}` };
    default:
      return { error: `Unknown operation: ${(req as { operation: string }).operation}` };
  }
}

const ACCOUNT_LEVEL_OPERATIONS: ConversationsOperation[] = ['list_accounts', 'activate_account'];

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

  const body = await request.json().catch(() => null) as ConversationsRequest | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const isAccountLevel = ACCOUNT_LEVEL_OPERATIONS.includes(body.operation);
  if (!isAccountLevel && (!body.brandId || typeof body.brandId !== 'string')) {
    return NextResponse.json({ error: 'brandId (string) is required' }, { status: 400 });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!isAccountLevel && !UUID_RE.test(body.brandId!)) {
    return NextResponse.json({ error: 'brandId must be a valid UUID' }, { status: 400 });
  }

  const resolved = resolveRequest(body);
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const requestHost = request.headers.get('host') || '';
  const host = reamazeHost(requestHost);
  let url: string;
  if (isAccountLevel) {
    const bffHost = reamazeBffHost(requestHost);
    url = `https://${bffHost}/bff/${resolved.path.replace(/^\//, '')}`;
  } else {
    url = `https://${body.brandId}.${host}/api/v2/${resolved.path.replace(/^\//, '')}`;
  }
  const hasBody = resolved.method !== 'GET' && body.body !== undefined;

  logger.info('conversations.bff.proxy.start', {
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
    ...(hasBody && { body: JSON.stringify(body.body) }),
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('conversations.bff.proxy.exception', {
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
      logger.warn('conversations.bff.proxy.non-json', {
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
    logger.warn('conversations.bff.proxy.error', {
      operation: body.operation,
      brandId: body.brandId,
      status: upstream.status,
      path: resolved.path,
      upstreamBody: data ? JSON.stringify(data).slice(0, 1000) : null,
    });
  } else {
    logger.info('conversations.bff.proxy.success', {
      operation: body.operation,
      brandId: body.brandId,
      status: upstream.status,
    });
  }

  // Return upstream status + body verbatim so the agent tool can branch on it
  return NextResponse.json({ status: upstream.status, data }, { status: 200 });
}, { level: 3 });
