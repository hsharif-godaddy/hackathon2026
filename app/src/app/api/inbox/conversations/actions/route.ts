/**
 * PUT /api/inbox/conversations/actions
 *
 * Execute a bulk action (resolve, unresolve, etc.) on one or more conversations.
 * Proxies to Reamaze PUT /api/v2/conversations/bulk.
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { ACTION_REGISTRY } from '@/lib/inbox/actions/config';
import { getReamazeHost, UUID_RE } from '@/lib/inbox/reamaze-host';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

const ALLOWED_ACTIONS: ReadonlySet<string> = new Set(Object.keys(ACTION_REGISTRY));
const MAX_CONVERSATION_IDS = 100;

export const PUT = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json(
      { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (parseError) {
    const e = parseError instanceof Error ? parseError : new Error(String(parseError));
    logger.warn('inbox.conversations.action.parse.request', { error: e.message });
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const { brandId, conversationIds, action } = body as {
    brandId?: string;
    conversationIds?: string[];
    action?: string;
  };

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json(
      { error: 'brandId (valid UUID) is required' },
      { status: 400 },
    );
  }

  if (
    !Array.isArray(conversationIds) ||
    conversationIds.length === 0 ||
    !conversationIds.every((id: unknown): id is string => typeof id === 'string' && id.length > 0)
  ) {
    return NextResponse.json(
      { error: 'conversationIds must be a non-empty array of non-empty strings' },
      { status: 400 },
    );
  }

  if (conversationIds.length > MAX_CONVERSATION_IDS) {
    return NextResponse.json(
      { error: `conversationIds must not exceed ${MAX_CONVERSATION_IDS} items` },
      { status: 400 },
    );
  }

  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${[...ALLOWED_ACTIONS].join(', ')}` },
      { status: 400 },
    );
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/conversations/bulk`;

  logger.info('inbox.conversations.action.start', {
    brandId,
    action,
    conversationCount: conversationIds.length,
  });

  const upstream = await fetch(url, {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `sso-jwt ${authContext.jwt}`,
    },
    body: JSON.stringify({
      conversation_ids: conversationIds,
      bulk_action: action,
    }),
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.conversations.action.exception', {
      brandId,
      action,
      error: e.message,
    });
    return null;
  });

  if (!upstream) {
    return NextResponse.json(
      { error: 'Failed to reach Reamaze' },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const contentType = upstream.headers.get('content-type') ?? '';
    let errorData: Record<string, unknown> = {};
    if (contentType.includes('application/json')) {
      errorData = await upstream.json().catch(() => ({}));
    } else {
      const rawBody = await upstream.text().catch(() => '');
      errorData = { rawBody: rawBody.slice(0, 500) };
    }
    logger.warn('inbox.conversations.action.error', {
      brandId,
      action,
      status: upstream.status,
      contentType,
      error: errorData,
    });
    return NextResponse.json(
      { error: (errorData.error as string) || `Unable to complete the action (upstream ${upstream.status})` },
      { status: upstream.status },
    );
  }

  const data: unknown = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.conversations.action.parse.exception', {
      brandId,
      action,
      error: e.message,
    });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json(
      { error: 'Invalid response from Reamaze' },
      { status: 502 },
    );
  }

  logger.info('inbox.conversations.action.success', {
    brandId,
    action,
    conversationCount: conversationIds.length,
  });

  return NextResponse.json({ success: true });
});
