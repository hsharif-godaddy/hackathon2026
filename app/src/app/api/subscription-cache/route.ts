import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/subscription-cache - Get subscription cache data
 * 
 * Returns all subscriptions, systems, and apps for building the client-side cache
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('subscription-cache.api.start', {
      message: 'Fetching subscription cache data via API route'
    });

    // Fetch customer info
    const customer = await client.checkCustomer();
    
    // Fetch all subscriptions
    const subscriptions = await client.getSubscriptions();
    
    // Build app location maps
    const appToSubscription = new Map<string, string>();
    const appToSystem = new Map<string, string>();
    const subscriptionData = new Map<string, any>();
    
    // Process each subscription
    for (const subscription of subscriptions) {
      subscriptionData.set(subscription.id, {
        subscription,
        systems: new Map<string, any>()
      });
      
      try {
        // Get systems for this subscription
        const systems = await client.getSystems(subscription.id);
        
        for (const system of systems) {
          subscriptionData.get(subscription.id)!.systems.set(system.systemId, {
            system,
            apps: []
          });
          
          try {
            // Get apps for this system
            const apps = await client.getAppsForSystem(subscription.id, system.systemId);
            
            for (const app of apps) {
              // Build lookup maps
              appToSubscription.set(app.id, subscription.id);
              appToSystem.set(app.id, system.systemId);
              
              // Store app data
              subscriptionData.get(subscription.id)!.systems.get(system.systemId)!.apps.push(app);
            }
          } catch (error) {
            logger.warn('subscription-cache.api.apps-error', {
              subscriptionId: subscription.id,
              systemId: system.systemId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      } catch (error) {
        logger.warn('subscription-cache.api.systems-error', {
          subscriptionId: subscription.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Convert Maps to objects for JSON serialization
    const response = {
      customerId: customer.customerId,
      subscriptions: Object.fromEntries(
        Array.from(subscriptionData.entries()).map(([id, data]) => [
          id,
          {
            subscription: data.subscription,
            systems: Object.fromEntries(
              Array.from(data.systems.entries()).map(([systemId, systemData]) => [
                systemId,
                {
                  system: systemData.system,
                  apps: systemData.apps
                }
              ])
            )
          }
        ])
      ),
      appToSubscription: Object.fromEntries(appToSubscription),
      appToSystem: Object.fromEntries(appToSystem),
      timestamp: Date.now()
    };

    logger.info('subscription-cache.api.success', {
      customerId: customer.customerId,
      subscriptionCount: subscriptions.length,
      totalApps: appToSubscription.size
    });

    return NextResponse.json(response);

  } catch (error) {
    // Auth failures (401/403) are expected for unregistered/expired users — log at warn, not error
    const isAuthError = error instanceof AiroHttpError && (error.status === 401 || error.status === 403);
    logger[isAuthError ? 'warn' : 'error']('subscription-cache.api.error', {
      message: 'Failed to fetch subscription cache data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    if (error instanceof AiroHttpError) {
      return NextResponse.json(
        { error: 'Failed to fetch subscription cache data' },
        { status: error.status ?? 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch subscription cache data' },
      { status: 500 }
    );
  }
});

