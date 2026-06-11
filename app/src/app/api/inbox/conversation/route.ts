/**
 * GET /api/inbox/conversation?conversationId={id}&brandId={uuid}
 *
 * Fetch a single conversation for a given brand from Reamaze.
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

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json(
      { error: 'brandId (valid UUID) is required' },
      { status: 400 }
    );
  }

  const INT_ID_RE = /^\d+$/;
  if (!conversationId || !INT_ID_RE.test(conversationId)) {
    return NextResponse.json(
      { error: 'conversationId (numeric ID) is required' },
      { status: 400 }
    );
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = new URL(`https://${brandId}.${REAMAZE_HOST}/api/v2/conversations/${conversationId}`);

  logger.info('inbox.conversation.fetch.start', {
    conversationId,
    brandId,
  });

  const upstream = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.conversation.fetch.exception', {
      conversationId,
      brandId,
      error: e.message,
    });
    return null;
  });

  if (!upstream) {
    return NextResponse.json(
      { error: 'Failed to fetch conversation from Reamaze' },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.conversation.fetch.error', {
      conversationId,
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
    logger.error('inbox.conversation.parse.exception', {
      conversationId,
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

  logger.info('inbox.conversation.fetch.success', {
    conversationId,
    brandId,
  });

  return NextResponse.json(data);
});
