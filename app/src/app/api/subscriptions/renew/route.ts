import { NextRequest, NextResponse } from 'next/server';

import { getCurrencyFromCookie, getMarketFromCookie } from '@/lib/apm-context';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { getRootDomainFromHeaders } from '@/utils/getRootDomain';
import { getSubscriptionsShimBaseUrl } from '@/utils/subscriptions-shim';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 30000;

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface RenewRequestBody {
  subscriptionId: string;
}

/**
 * POST /api/subscriptions/renew
 *
 * Renew a suspended subscription via the subscriptions-shim API.
 * This endpoint is used when a subscription is suspended due to non-payment.
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const body: RenewRequestBody = await request.json();
    const { subscriptionId } = body;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    }

    const { user } = authContext;
    const customerId = user.customerId;
    const rootDomain = getRootDomainFromHeaders(request.headers);
    const baseUrl = getSubscriptionsShimBaseUrl(rootDomain);

    logger.info('subscription.renew.start', {
      customerId,
      subscriptionId,
    });

    // First, get the subscription details to retrieve the revision for optimistic locking
    const subscriptionDetailsUrl = `${baseUrl}/v2/customers/${customerId}/subscriptions/${subscriptionId}`;

    const detailsResponse = await fetchWithTimeout(subscriptionDetailsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
        'X-App-Key': 'airo-builder',
      },
    });

    if (!detailsResponse.ok) {
      const errorText = await detailsResponse.text();
      logger.error('subscription.renew.details-failed', {
        customerId,
        subscriptionId,
        status: detailsResponse.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'Failed to get subscription details' },
        { status: detailsResponse.status }
      );
    }

    const details = await detailsResponse.json();

    const revision = details?.metadata?.revision;
    const term = details?.offer?.term;

    if (!revision) {
      logger.error('subscription.renew.no-revision', {
        customerId,
        subscriptionId,
      });
      return NextResponse.json(
        { error: 'No revision found for subscription' },
        { status: 500 }
      );
    }

    if (!term || !term.termType || typeof term.numberOfTerms !== 'number') {
      logger.error('subscription.renew.missing-term', {
        customerId,
        subscriptionId,
        term,
      });
      return NextResponse.json(
        { error: 'Missing term information for subscription' },
        { status: 500 }
      );
    }

    const cookieHeader = request.headers.get('cookie');
    const marketId = getMarketFromCookie(cookieHeader) || 'en-US';
    const currency = getCurrencyFromCookie(cookieHeader) || 'USD';

    // Generate idempotent ID for the renewal request
    const idempotentId = crypto.randomUUID();

    const renewUrl = `${baseUrl}/v2/customers/${customerId}/subscriptions/renew`;

    const requestBody = {
      marketId,
      currency,
      renewSubscriptions: [
        {
          subscriptionId,
          term,
        },
      ],
    };

    const renewResponse = await fetchWithTimeout(renewUrl, {
      method: 'POST',
      headers: {
        'Authorization': `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
        'X-App-Key': 'airo-builder',
        'Idempotent-Id': idempotentId,
        'If-Match': String(revision),
      },
      body: JSON.stringify(requestBody),
    });

    if (!renewResponse.ok) {
      const errorText = await renewResponse.text();
      logger.error('subscription.renew.failed', {
        customerId,
        subscriptionId,
        status: renewResponse.status,
        error: errorText,
        requestBody,
        revision,
      });
      return NextResponse.json(
        { error: 'Failed to renew subscription' },
        { status: renewResponse.status }
      );
    }

    const renewData = await renewResponse.json();

    logger.info('subscription.renew.success', {
      customerId,
      subscriptionId,
      response: renewData,
    });

    return NextResponse.json({
      success: true,
      data: renewData,
    });

  } catch (error) {
    logger.error('subscription.renew.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to renew subscription' },
      { status: 500 }
    );
  }
});
