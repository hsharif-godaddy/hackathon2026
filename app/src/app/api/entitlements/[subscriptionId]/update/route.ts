import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { VentureService } from '@/lib/venture-service';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * PUT /api/entitlements/[subscriptionId]/update - Update entitlement for a subscription
 *
 * Updates the entitlement for a specific subscription.
 *
 * Path Parameters:
 * - subscriptionId: The subscription ID to update (required)
 *
 * Request Body:
 * - entitlementId: The new entitlement ID (required)
 */
async function customerOwnsEntitlement(
  ventureService: VentureService,
  customerId: string,
  entitlementId: string
): Promise<boolean> {
  let after: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const projectsResponse = await ventureService.getCustomerProjects(customerId, after);
    const edges = projectsResponse?.projects?.edges ?? [];

    const ownsEntitlement = edges.some(edge => edge?.node?.billing?.id === entitlementId);
    if (ownsEntitlement) {
      return true;
    }

    const pageInfo = projectsResponse?.projects?.pageInfo;
    if (pageInfo?.hasNextPage && pageInfo?.endCursor) {
      after = pageInfo.endCursor;
      continue;
    }

    break;
  }

  return false;
}

export const PUT = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: { subscriptionId: string } }): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // When app-builder-grants is enabled, this legacy entitlement update endpoint is disabled
    // Access control is based solely on subscription plans, not entitlements
    const isGrantsEnabled = await checkSwitchboardFlag(
      'app-builder-grants',
      authContext.jwt,
      request.headers
    );

    if (isGrantsEnabled) {
      logger.info('entitlements.api.update.disabled', {
        message: 'Entitlement update endpoint disabled when app-builder-grants is enabled',
      });
      return NextResponse.json(
        { error: 'This endpoint is deprecated. Use subscription plans for access control.' },
        { status: 410 }
      );
    }

    const { subscriptionId } = params;
    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId path parameter is required' }, { status: 400 });
    }

    const { entitlementId, appId } = await request.json();
    if (!entitlementId) {
      return NextResponse.json({ error: 'entitlementId is required in request body' }, { status: 400 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });
    const ventureService = new VentureService(authContext.jwt);
    const { user } = authContext;

    logger.info('entitlements.api.update.start', {
      subscriptionId,
      entitlementId,
      ...(appId && { appId })
    });

    const subscription = await client.getEntitlements(subscriptionId);
    if (!subscription || !subscription.id) {
      logger.warn('entitlements.api.update.subscription-not-found', {
        subscriptionId
      });
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    if (subscription.customerId !== user.customerId) {
      logger.warn('entitlements.api.update.unauthorized', {
        subscriptionId,
        subscriptionCustomerId: subscription.customerId,
        customerId: user.customerId
      });
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const entitlementOwned = await customerOwnsEntitlement(ventureService, user.customerId, entitlementId);
    if (!entitlementOwned) {
      logger.warn('entitlements.api.update.entitlement-unauthorized', {
        subscriptionId,
        entitlementId,
        customerId: user.customerId
      });
      return NextResponse.json(
        { error: 'Entitlement does not belong to this customer' },
        { status: 403 }
      );
    }

    // Call updateEntitlement method
    const updatedSubscription = await client.updateEntitlement(subscriptionId, { entitlementId });

    // Validate subscription response
    if (!updatedSubscription || !updatedSubscription.id) {
      logger.warn('entitlements.api.update.failed', {
        subscriptionId,
        entitlementId,
        response: updatedSubscription
      });
      return NextResponse.json(
        { error: 'Failed to update entitlement', details: updatedSubscription },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Entitlement updated successfully',
      data: {
        subscription: updatedSubscription,
        subscriptionId: updatedSubscription.id,
        entitlementId: updatedSubscription.entitlementId
      }
    });

  } catch (error) {
    logger.error('entitlements.api.update.error', {
      message: 'Failed to update entitlement',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    if (error instanceof AiroHttpError) {
      return NextResponse.json(
        { error: error.status === 404 ? 'Subscription not found' : 'Failed to update entitlement' },
        { status: error.status }
      );
    }
    return NextResponse.json({ error: 'Failed to update entitlement' }, { status: 500 });
  }
}, { level: 3 });
