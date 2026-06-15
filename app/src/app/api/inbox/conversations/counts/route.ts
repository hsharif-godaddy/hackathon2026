/**
 * GET /api/inbox/conversations/counts?brandId={uuid}
 *
 * Fetch the unread-conversation count for a given brand from Reamaze
 * (counts_only=true&filter=unread). Returns { total_count } verbatim.
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

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json(
      { error: 'brandId (valid UUID) is required' },
      { status: 400 },
    );
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = new URL(`https://${brandId}.${REAMAZE_HOST}/api/v2/conversations`);
  url.searchParams.set('counts_only', 'true');
  url.searchParams.set('filter', 'unread');

  logger.info('inbox.unread_count.fetch.start', { brandId });

  const upstream = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.unread_count.fetch.exception', { brandId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json(
      { error: 'Failed to fetch unread count from Reamaze' },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.unread_count.fetch.error', {
      brandId,
      status: upstream.status,
      error: errorData,
    });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.unread_count.parse.exception', { brandId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json(
      { error: 'Invalid response from Reamaze' },
      { status: 502 },
    );
  }

  logger.info('inbox.unread_count.fetch.success', {
    brandId,
    totalCount: data.total_count ?? 0,
  });

  return NextResponse.json(data);
});
