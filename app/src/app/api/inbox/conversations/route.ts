/**
 * GET /api/inbox/conversations?brandId={uuid}&before_timestamp={iso}
 *
 * Fetch conversations for a given brand from Reamaze.
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { getReamazeHost, UUID_RE } from '@/lib/inbox/reamaze-host';
import { logger } from '@/lib/request-context';
import type { InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

type FilterableStatus = Exclude<InboxConversationStatusFilter, 'all'>;

const POSITIVE_INT_RE = /^[1-9]\d*$/;
const FILTER_TO_REAMAZE: Record<FilterableStatus, string> = {
  unresolved: 'open',
  resolved: 'resolved',
};
const ALLOWED_FILTERS: readonly string[] = Object.keys(FILTER_TO_REAMAZE);

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
  const beforeTimestamp = searchParams.get('before_timestamp');
  const page = searchParams.get('page');
  const filter = searchParams.get('filter');

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json(
      { error: 'brandId (valid UUID) is required' },
      { status: 400 }
    );
  }

  if (page && !POSITIVE_INT_RE.test(page)) {
    return NextResponse.json(
      { error: 'page must be a positive integer' },
      { status: 400 }
    );
  }

  if (filter && !ALLOWED_FILTERS.includes(filter)) {
    return NextResponse.json(
      { error: `filter must be one of: ${ALLOWED_FILTERS.join(', ')}` },
      { status: 400 }
    );
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = new URL(`https://${brandId}.${REAMAZE_HOST}/api/v2/conversations`);
  url.searchParams.set('sort', 'updated');
  if (beforeTimestamp) {
    url.searchParams.set('before_timestamp', beforeTimestamp);
  }

  if (page) {
    url.searchParams.set('page', page);
  }

  if (filter) {
    url.searchParams.set('filter', FILTER_TO_REAMAZE[filter as FilterableStatus]);
  }

  logger.info('inbox.conversations.fetch.start', {
    brandId,
    beforeTimestamp,
    page,
    filter,
  });

  const upstream = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.conversations.fetch.exception', {
      brandId,
      error: e.message,
    });
    return null;
  });

  if (!upstream) {
    return NextResponse.json(
      { error: 'Failed to fetch conversations from Reamaze' },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.conversations.fetch.error', {
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
    logger.error('inbox.conversations.parse.exception', {
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

  logger.info('inbox.conversations.fetch.success', {
    brandId,
    conversationCount: data.conversations?.length ?? 0,
  });

  return NextResponse.json(data);
});
