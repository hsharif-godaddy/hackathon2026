/**
 * Server-Side Paywall Data Provider
 *
 * Implementation of PaywallDataProvider for server/Node.js environment.
 * Uses direct service clients and explicit JWT authentication.
 */

import { AIRO_OWNER_PRODUCTS, AiroMgmtClient, type AiroSubscription } from '@/lib/mgmt-airo';
import { filterPublishedApps } from '@/lib/publish-limit';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { SubscriptionPlan, SubscriptionStatus } from '@/types/credits';
import { getPlanFromSubscription } from '@/utils/credits';
import { getRootDomainFromHeaders } from '@/utils/getRootDomain';
import type { AccountSubscription, PaywallDataProvider, PublishedAppsData, SwitchboardFlagsResult } from './providers';
import { PLAN_PRIORITY, type ProjectEdge } from './shared';

/**
 * Server-side implementation of paywall data provider
 *
 * This implementation:
 * - Uses AiroMgmtClient directly (no API routes)
 * - Parses request headers for root domain
 * - Uses explicit JWT tokens for authentication
 */
export class ServerPaywallProvider implements PaywallDataProvider {
  private jwt: string;
  private customerId: string;
  private headers: Headers;

  /**
   * Create a server-side paywall provider
   *
   * @param jwt - User's JWT token for authentication
   * @param customerId - Customer ID for project lookups
   * @param headers - Request headers for domain extraction
   */
  constructor(jwt: string, customerId: string, headers: Headers) {
    this.jwt = jwt;
    this.customerId = customerId;
    this.headers = headers;
  }

  /**
   * Get root domain from request headers
   *
   * Uses the shared getRootDomainFromHeaders utility to extract the root domain
   * from the Host header, with proper handling for development environments.
   *
   * @returns Root domain or null if header not found
   */
  getRootDomain(): string | null {
    return getRootDomainFromHeaders(this.headers);
  }

  /**
   * Check switchboard feature flags for paywall control.
   *
   * The paywall is always enabled (no longer gated by feature flags).
   * Only the bypass-publish-limit flag is still fetched as an operational escape hatch.
   */
  async checkSwitchboardFlags(_rootDomain: string): Promise<SwitchboardFlagsResult> {
    const bypassPublishLimit = await checkSwitchboardFlag('app-builder-bypass-publish-limit', { headers: this.headers });
    return { bypassPublishLimit };
  }

  /**
   * Get account-level subscription (app-agnostic)
   *
   * Gets the customer's subscription with plan information.
   * Prioritizes active paid subscriptions over free ones.
   *
   * @returns Promise with account subscription data
   */
  async getAccountSubscription(): Promise<AccountSubscription | undefined> {
    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: this.jwt });

    const subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);

    logger.info('paywall.server-provider.get-account-subscription', {
      message: 'Fetched account subscription data',
    });

    // Prioritize subscriptions by plan type for selection
    // Order of precedence: starter > free > airoPlus > none
    // Note: This priority is for subscription selection, NOT access control.
    // Only Starter, Professional, Ultimate grant paid access (AiroPlus does not).
    let bestSubscription: (AiroSubscription & { plan: SubscriptionPlan }) | null = null;

    for (const subscription of subscriptions) {
      // Skip inactive subscriptions unless we have nothing else
      if (subscription.status !== SubscriptionStatus.Active && bestSubscription) {
        continue;
      }

      // Determine plan from subscription data
      const plan = getPlanFromSubscription(subscription);

      // Keep the subscription with the highest priority plan
      if (!bestSubscription ||
          (PLAN_PRIORITY[plan] || 0) > (PLAN_PRIORITY[bestSubscription.plan] || 0)) {
        bestSubscription = {
          ...subscription,
          plan
        };
      }
    }

    if (!bestSubscription) {
      // No subscription found - user needs to sign up first
      logger.info('paywall.server-provider.no-subscription', {
        customerId: this.customerId,
        message: 'No subscription found for customer'
      });
      return undefined;
    }

    // Try to fetch full subscription details via entitlements endpoint
    try {
      const fullSubscription = await client.getEntitlements(bestSubscription.id);
      return {
        id: fullSubscription.id,
        productId: fullSubscription.productId,
        customerId: fullSubscription.customerId,
        status: fullSubscription.status,
        isTrial: fullSubscription.isTrial,
        entitlementId: fullSubscription.entitlementId,
        builderEntitlementId: fullSubscription.builderEntitlementId,
        hadAiroPlus: fullSubscription.hadAiroPlus,
        plan: fullSubscription.plan || bestSubscription.plan,
        renewsAt: fullSubscription.renewsAt
      };
    } catch (error) {
      // If we can't fetch full details, return what we have
      logger.warn('paywall.server-provider.subscription-detail-error', {
        subscriptionId: bestSubscription.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return bestSubscription;
    }
  }

  /**
   * Get subscription ID for an app (deprecated - use getAccountSubscription)
   *
   * Searches through all subscriptions, systems, and apps to find the
   * subscription containing the specified app.
   *
   * This is more complex than the client implementation because we need
   * to use the mgmt-airo client directly instead of an API route.
   *
   * @param appId - The app ID to find subscription for
   * @returns Promise with subscription ID or undefined
   * @deprecated Use getAccountSubscription() for app-agnostic subscriptions
   */
  async getSubscription(appId: string): Promise<string | undefined> {
    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: this.jwt });

    const subscriptions = await client.getSubscriptions(
      AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER
    );

    // Search through subscriptions and systems to find the app
    for (const subscription of subscriptions) {
      try {
        const systems = await client.getSystems(subscription.id);

        for (const system of systems) {
          try {
            const apps = await client.getAppsForSystem(subscription.id, system.systemId);
            const targetApp = apps.find((app) => app.id === appId);

            if (targetApp) {
              return subscription.id;
            }
          } catch (error) {
            logger.warn('paywall.server-provider.apps-error', {
              appId,
              subscriptionId: subscription.id,
              systemId: system.systemId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        logger.warn('paywall.server-provider.systems-error', {
          appId,
          subscriptionId: subscription.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return undefined;
  }

  /**
   * Get entitlements for a subscription
   *
   * Uses AiroMgmtClient to fetch subscription with entitlement information.
   *
   * @param subscriptionId - The subscription ID to check
   * @returns Promise with entitlement ID or undefined
   */
  async getEntitlements(subscriptionId: string): Promise<string | undefined> {
    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: this.jwt });

    try {
      const subscription = await client.getEntitlements(subscriptionId);
      return subscription.entitlementId;
    } catch (error) {
      logger.warn('paywall.server-provider.entitlements-error', {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Get user's projects
   *
   * @returns Empty array, grants always enabled
   */
  async getProjects(): Promise<ProjectEdge[]> {
    logger.info('paywall.server-provider.projects-skipped', {
      customerId: this.customerId,
      message: 'Project lookups disabled, grants always enabled',
    });
    return [];
  }

  /**
   * Get published apps data
   *
   * Uses AiroMgmtClient to get all apps and filters for apps with active 'publish' variant.
   * Throws on error to ensure fail-closed behavior for publish limit checks.
   *
   * @returns Promise with published apps count and IDs
   * @throws Error if unable to fetch published apps (fail-closed for security)
   */
  async getPublishedApps(): Promise<PublishedAppsData> {
    try {
      const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
      const client = new AiroMgmtClient({ baseUrl, jwt: this.jwt });

      const apps = await client.getAllAppsForCustomer();
      const publishedApps = filterPublishedApps(apps);

      return {
        count: publishedApps.length,
        publishedAppIds: publishedApps.map(app => app.id),
      };
    } catch (error) {
      logger.error('paywall.server-provider.published-apps.fetch-failed', {
        customerId: this.customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
