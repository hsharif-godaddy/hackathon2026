/**
 * GET /api/inbox/messages?conversationId={id}&brandId={uuid}&before_timestamp={iso}
 * GET /api/inbox/messages?parentMessageId={id}&brandId={uuid}&before_timestamp={iso}
 *
 * Fetch messages for a conversation OR children for a parent message.
 * Routes to the appropriate Reamaze endpoint based on which ID is provided.
 *
 * Auth: level 3 (reads customer data from external system).
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { getReamazeHost, UUID_RE } from '@/lib/inbox/reamaze-host';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json(
      { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');
  const conversationId = searchParams.get('conversationId');
  const parentMessageId = searchParams.get('parentMessageId');
  const beforeTimestamp = searchParams.get('before_timestamp');

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json(
      { error: 'brandId (valid UUID) is required' },
      { status: 400 }
    );
  }

  if (!conversationId && !parentMessageId) {
    return NextResponse.json(
      { error: 'Either conversationId or parentMessageId is required' },
      { status: 400 }
    );
  }

  if (conversationId && parentMessageId) {
    return NextResponse.json(
      { error: 'Cannot specify both conversationId and parentMessageId' },
      { status: 400 }
    );
  }

  const INT_ID_RE = /^\d+$/;
  if (conversationId && !INT_ID_RE.test(conversationId)) {
    return NextResponse.json(
      { error: 'conversationId must be a numeric ID' },
      { status: 400 }
    );
  }

  if (parentMessageId && !INT_ID_RE.test(parentMessageId)) {
    return NextResponse.json(
      { error: 'parentMessageId must be a numeric ID' },
      { status: 400 }
    );
  }

  const REAMAZE_HOST = getReamazeHost();
  const fetchingChildren = !!parentMessageId;
  const id = fetchingChildren ? parentMessageId : conversationId;
  const urlPath = fetchingChildren
    ? `/api/v2/messages/${id}/children`
    : `/api/v2/conversations/${id}/messages`;

  const url = new URL(`https://${brandId}.${REAMAZE_HOST}${urlPath}`);
  if (beforeTimestamp) {
    url.searchParams.set('before_timestamp', beforeTimestamp);
  }

  logger.info('inbox.messages.fetch.start', {
    conversationId,
    parentMessageId,
    brandId,
    beforeTimestamp,
    fetchingChildren,
  });

  const upstream = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.messages.fetch.exception', {
      conversationId,
      parentMessageId,
      brandId,
      error: e.message,
    });
    return null;
  });

  if (!upstream) {
    return NextResponse.json(
      { error: 'Failed to fetch messages from Reamaze' },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.messages.fetch.error', {
      conversationId,
      parentMessageId,
      brandId,
      status: upstream.status,
      error: errorData,
    });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.messages.parse.exception', {
      conversationId,
      parentMessageId,
      brandId,
      error: e.message,
    });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json(
      { error: 'Invalid response from Reamaze' },
      { status: 502 }
    );
  }

  logger.info('inbox.messages.fetch.success', {
    conversationId,
    parentMessageId,
    brandId,
    messageCount: data.messages?.length ?? 0,
  });

  return NextResponse.json(data);
}, { level: 3 });
