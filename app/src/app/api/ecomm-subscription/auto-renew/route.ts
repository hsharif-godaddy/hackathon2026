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

interface AutoRenewRequestBody {
  builderEntitlementId: string;
  autoRenew: boolean;
}

/**
 * POST /api/ecomm-subscription/auto-renew
 *
 * Toggle autoRenew on the ecomm subscription associated with a builder entitlement.
 * - autoRenew: false = schedule downgrade to Free at next renewal
 * - autoRenew: true = cancel scheduled downgrade
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const body: AutoRenewRequestBody = await request.json();
    const { builderEntitlementId, autoRenew } = body;

    if (!builderEntitlementId) {
      return NextResponse.json({ error: 'builderEntitlementId is required' }, { status: 400 });
    }

    if (typeof autoRenew !== 'boolean') {
      return NextResponse.json({ error: 'autoRenew must be a boolean' }, { status: 400 });
    }

    const { user } = authContext;
    const customerId = user.customerId;
    const rootDomain = getRootDomainFromHeaders(request.headers);
    const baseUrl = getSubscriptionsShimBaseUrl(rootDomain);

    logger.info('ecomm-subscription.auto-renew.start', {
      customerId,
      builderEntitlementId,
      autoRenew,
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
      logger.error('ecomm-subscription.auto-renew.lookup-failed', {
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
    const revision = subscriptionData?.metadata?.revision;

    if (!subscriptionId) {
      logger.error('ecomm-subscription.auto-renew.no-subscription-id', {
        customerId,
        builderEntitlementId,
        response: subscriptionData,
      });
      return NextResponse.json(
        { error: 'No subscription found for entitlement' },
        { status: 404 }
      );
    }

    if (!revision) {
      logger.error('ecomm-subscription.auto-renew.no-revision', {
        customerId,
        builderEntitlementId,
        subscriptionId,
        response: subscriptionData,
      });
      return NextResponse.json(
        { error: 'No revision found for subscription' },
        { status: 500 }
      );
    }

    // Update autoRenew on the subscription
    const autoRenewUrl = `${baseUrl}/v2/customers/${customerId}/subscriptions/${subscriptionId}/autoRenew`;

    const autoRenewResponse = await fetchWithTimeout(autoRenewUrl, {
      method: 'POST',
      headers: {
        'Authorization': `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
        'X-App-Key': 'airo-builder',
        'If-Match': revision,
        'Idempotent-Id': crypto.randomUUID(),
      },
      body: JSON.stringify({ autoRenew }),
    });

    if (!autoRenewResponse.ok) {
      const errorText = await autoRenewResponse.text();

      logger.error('ecomm-subscription.auto-renew.update-failed', {
        customerId,
        subscriptionId,
        autoRenew,
        status: autoRenewResponse.status,
        error: errorText,
      });

      return NextResponse.json(
        { error: 'Failed to update auto-renew status', details: errorText },
        { status: autoRenewResponse.status }
      );
    }

    logger.info('ecomm-subscription.auto-renew.success', {
      customerId,
      subscriptionId,
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    logger.error('ecomm-subscription.auto-renew.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to update auto-renew status' },
      { status: 500 }
    );
  }
});
