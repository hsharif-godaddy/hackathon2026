import { NextRequest, NextResponse } from 'next/server';

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

/**
 * GET /api/ecomm-subscription/status?builderEntitlementId={id}
 *
 * Get the autoRenew status and renewal date for the ecomm subscription
 * associated with a builder entitlement.
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const builderEntitlementId = searchParams.get('builderEntitlementId');

    if (!builderEntitlementId) {
      return NextResponse.json({ error: 'builderEntitlementId query parameter is required' }, { status: 400 });
    }

    const { user } = authContext;
    const customerId = user.customerId;
    const rootDomain = getRootDomainFromHeaders(request.headers);
    const baseUrl = getSubscriptionsShimBaseUrl(rootDomain);

    logger.info('ecomm-subscription.status.start', {
      customerId,
      builderEntitlementId,
    });

    const subscriptionLookupUrl = `${baseUrl}/v2/customers/${customerId}/subscriptionByEntitlementId?entitlementId=${encodeURIComponent(builderEntitlementId)}`;

    const subscriptionLookupResponse = await fetchWithTimeout(subscriptionLookupUrl, {
      method: 'GET',
      headers: {
        'Authorization': `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
        'X-App-Key': 'airo-builder'
      },
    });

    if (!subscriptionLookupResponse.ok) {
      const errorText = await subscriptionLookupResponse.text();
      logger.error('ecomm-subscription.status.lookup-failed', {
        customerId,
        builderEntitlementId,
        status: subscriptionLookupResponse.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'Failed to find subscription for entitlement' },
        { status: subscriptionLookupResponse.status }
      );
    }

    const subscriptionData = await subscriptionLookupResponse.json();
    const subscriptionId = subscriptionData.subscriptionId;

    if (!subscriptionId) {
      logger.error('ecomm-subscription.status.no-subscription-id', {
        customerId,
        builderEntitlementId,
        response: subscriptionData,
      });
      return NextResponse.json(
        { error: 'No subscription found for entitlement' },
        { status: 404 }
      );
    }

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
      logger.error('ecomm-subscription.status.details-failed', {
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

    const autoRenew = details?.offer?.autoRenew;
    if (typeof autoRenew !== 'boolean') {
      logger.error('ecomm-subscription.status.invalid-auto-renew', {
        customerId,
        subscriptionId,
        autoRenewValue: autoRenew,
      });
      return NextResponse.json(
        { error: 'Subscription details missing valid autoRenew flag' },
        { status: 500 }
      );
    }

    logger.info('ecomm-subscription.status.success', {
      customerId,
      subscriptionId,
      autoRenew,
      paidThroughDate: details?.paidThroughDate,
    });

    return NextResponse.json({
      subscriptionId,
      autoRenew,
      paidThroughDate: details?.paidThroughDate,
    });

  } catch (error) {
    logger.error('ecomm-subscription.status.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to get subscription status' },
      { status: 500 }
    );
  }
});
