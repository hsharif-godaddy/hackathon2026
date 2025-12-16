import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import { AIRO_OWNER_PRODUCTS,AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/apps/[id]/subscription - Get subscription data for a specific app
 *
 * Returns the subscription and system information for a specific app ID.
 * This is a targeted lookup that avoids building the full subscription cache.
 *
 * Path Parameters:
 * - id: The app ID to find subscription data for
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { id: appId } = await params;

    if (!appId) {
      return NextResponse.json({ error: 'appId path parameter is required' }, { status: 400 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('subscription.api.start', {
      message: 'Fetching subscription data for app',
      appId
    });

    // Get all subscriptions to find the one containing our app
    // Use ownerProduct for forward compatibility
    const subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);

    // Search through subscriptions and systems to find the app
    for (const subscription of subscriptions) {
      try {
        // Get systems for this subscription
        const systems = await client.getSystems(subscription.id);

        for (const system of systems) {
          try {
            // Get apps for this system
            const apps = await client.getAppsForSystem(subscription.id, system.systemId);

            // Check if our target app is in this system
            const targetApp = apps.find(app => app.id === appId);

            if (targetApp) {
              logger.info('subscription.api.found', {
                appId,
                subscriptionId: subscription.id,
                systemId: system.systemId
              });

              return NextResponse.json({
                success: true,
                data: {
                  app: targetApp,
                  subscription: {
                    id: subscription.id,
                    productId: subscription.productId,
                    status: subscription.status,
                    isTrial: subscription.isTrial
                  },
                  system: {
                    systemId: system.systemId,
                    datacenter: system.datacenter
                  }
                }
              });
            }
          } catch (error) {
            logger.warn('subscription.api.apps-error', {
              appId,
              subscriptionId: subscription.id,
              systemId: system.systemId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      } catch (error) {
        logger.warn('subscription.api.systems-error', {
          appId,
          subscriptionId: subscription.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // App not found in any subscription
    logger.warn('subscription.api.not-found', {
      appId,
      searchedSubscriptions: subscriptions.length
    });

    return NextResponse.json(
      { error: 'App not found in any subscription' },
      { status: 404 }
    );

  } catch (error) {
    logger.error('subscription.api.error', {
      message: 'Failed to fetch subscription data for app',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Failed to fetch subscription data for app' },
      { status: 500 }
    );
  }
});
