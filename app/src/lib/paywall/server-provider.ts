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
import { VentureService } from '@/lib/venture-service';
import { SubscriptionPlan, SubscriptionStatus } from '@/types/credits';
import { getPlanFromSubscription } from '@/utils/credits';
import { getRootDomainFromHeaders } from '@/utils/getRootDomain';
import type { AccountSubscription, PaywallDataProvider, PublishedAppsData, SwitchboardFlagsResult } from './providers';
import { PAYWALL_CONFIG, PLAN_PRIORITY, type ProjectEdge } from './shared';

/**
 * Server-side implementation of paywall data provider
 *
 * This implementation:
 * - Uses AiroMgmtClient and VentureService directly (no API routes)
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
   * Check switchboard feature flags
   *
   * Calls the switchboard API with explicit JWT token in Cookie header.
   *
   * @param rootDomain - The root domain to construct switchboard URLs
   * @returns Promise with both flag states
   */
  async checkSwitchboardFlags(rootDomain: string): Promise<SwitchboardFlagsResult> {
    const { SWITCHBOARD_FLAGS, SWITCHBOARD_APP, BFF_HOST_PREFIX } = PAYWALL_CONFIG;

    const paywallFlagUrl = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/${SWITCHBOARD_FLAGS.PAYWALL}?app=${SWITCHBOARD_APP}`;
    const marketsFlagUrl = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/${SWITCHBOARD_FLAGS.MARKETS}?app=${SWITCHBOARD_APP}`;
    const grantsFlagUrl = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/app-builder-grants?app=${SWITCHBOARD_APP}`;
    const bypassFlagUrl = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/app-builder-bypass-publish-limit?app=${SWITCHBOARD_APP}`;

    const authHeaders = { 'Authorization': `sso-jwt ${this.jwt}` };

    const [paywallResponse, marketsResponse, grantsResponse, bypassResponse] = await Promise.all([
      fetch(paywallFlagUrl, { headers: authHeaders }),
      fetch(marketsFlagUrl, { headers: authHeaders }),
      fetch(grantsFlagUrl, { headers: authHeaders }).catch(() => null),
      fetch(bypassFlagUrl, { headers: authHeaders }).catch(() => null),
    ]);

    // Fail closed: Throw error if flag fetch fails
    // This ensures we show "service unavailable" rather than "you need to pay"
    // The error will be caught by core.ts and return proper "unable to verify" message
    if (!paywallResponse.ok) {
      logger.error('paywall.server-provider.flag-fetch.failure', {
        flag: SWITCHBOARD_FLAGS.PAYWALL,
        status: paywallResponse.status,
        url: paywallFlagUrl,
      });
      throw new Error(
        `Switchboard flag fetch failed: ${SWITCHBOARD_FLAGS.PAYWALL} (status: ${paywallResponse.status})`
      );
    }

    if (!marketsResponse.ok) {
      logger.error('paywall.server-provider.flag-fetch.failure', {
        flag: SWITCHBOARD_FLAGS.MARKETS,
        status: marketsResponse.status,
        url: marketsFlagUrl,
      });
      throw new Error(
        `Switchboard flag fetch failed: ${SWITCHBOARD_FLAGS.MARKETS} (status: ${marketsResponse.status})`
      );
    }

    // Parse flag responses
    let paywallFlag: boolean;
    let marketsFlag: boolean;
    let grantsFlag = false;
    let bypassFlag = false;

    try {
      const paywallData = await paywallResponse.json();
      paywallFlag = paywallData.setting ?? false;
    } catch (error) {
      logger.error('paywall.server-provider.flag-parse.failure', {
        flag: SWITCHBOARD_FLAGS.PAYWALL,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to parse switchboard flag: ${SWITCHBOARD_FLAGS.PAYWALL}`
      );
    }

    try {
      const marketsData = await marketsResponse.json();
      marketsFlag = marketsData.setting ?? false;
    } catch (error) {
      logger.error('paywall.server-provider.flag-parse.failure', {
        flag: SWITCHBOARD_FLAGS.MARKETS,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to parse switchboard flag: ${SWITCHBOARD_FLAGS.MARKETS}`
      );
    }

    // Parse grants and bypass flags (optional, don't fail if unavailable)
    if (grantsResponse?.ok) {
      try {
        const grantsData = await grantsResponse.json();
        grantsFlag = grantsData.setting ?? false;
      } catch {
        // Ignore parse errors for optional flags
      }
    }

    if (bypassResponse?.ok) {
      try {
        const bypassData = await bypassResponse.json();
        bypassFlag = bypassData.setting ?? false;
      } catch {
        // Ignore parse errors for optional flags
      }
    }

    return {
      paywall: paywallFlag,
      markets: marketsFlag,
      grants: grantsFlag,
      bypassPublishLimit: bypassFlag,
    };
  }

  /**
   * Get account-level subscription (app-agnostic)
   *
   * Gets the customer's subscription with plan information.
   * Prioritizes active paid subscriptions over free ones.
   * When app-builder-grants flag is enabled:
   * - Checks for free/starter plans
   * - Auto-creates free plan if subscription exists but has no valid plan
   *
   * When app-builder-grants flag is disabled (legacy):
   * - Only checks for airoPlus plans
   * - Does not auto-create plans
   *
   * @returns Promise with account subscription data
   */
  async getAccountSubscription(): Promise<AccountSubscription | undefined> {
    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: this.jwt });

    // Check if grants feature is enabled
    const isGrantsEnabled = await checkSwitchboardFlag(
      'app-builder-grants',
      this.jwt,
      this.headers
    );

    logger.info('paywall.server-provider.get-account-subscription', {
      message: 'Fetching account subscription',
      grantsEnabled: isGrantsEnabled
    });

    const subscriptions = await client.getSubscriptions(
      AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER
    );

    // Prioritize subscriptions by plan type for selection
    // Order of precedence: starter > free > airoPlus > none
    // Note: This priority is for subscription selection, NOT access control.
    // When grants is enabled, only Starter grants paid access (AiroPlus does not).
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
   * Check if app-builder-grants feature flag is enabled
   *
   * When enabled, access control is based solely on subscription plans
   * and legacy entitlements/project matching should be skipped.
   *
   * @returns Promise with boolean indicating if grants feature is enabled
   */
  async isGrantsEnabled(): Promise<boolean> {
    return checkSwitchboardFlag('app-builder-grants', this.jwt, this.headers);
  }

  /**
   * Get user's projects
   *
   * Uses VentureService to fetch customer projects with billing information.
   * TODO: This should be deprecated when grants is enabled pg project matching is no longer used for access control.
   * When app-builder-grants is enabled, this returns empty as project lookups
   * are no longer used for access control - only subscription plans matter.
   *
   * @returns Promise with array of project edges
   */
  async getProjects(): Promise<ProjectEdge[]> {
    // When app-builder-grants is enabled, skip product-graph project lookups
    // Access control is based solely on subscription plan (paid vs free)
    const isGrantsEnabled = await this.isGrantsEnabled();

    if (isGrantsEnabled) {
      logger.info('paywall.server-provider.projects-skipped', {
        customerId: this.customerId,
        message: 'Project lookups disabled when app-builder-grants is enabled',
      });
      return [];
    }

    const ventureService = new VentureService(this.jwt);

    try {
      const projectsData = await ventureService.getCustomerProjects(this.customerId);
      return projectsData?.projects?.edges || [];
    } catch (error) {
      logger.warn('paywall.server-provider.projects-error', {
        customerId: this.customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get published apps data
   *
   * Uses AiroMgmtClient to get all apps and filters for apps with active 'publish' variant.
   *
   * @returns Promise with published apps count and IDs
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
      logger.warn('paywall.server-provider.published-apps-error', {
        customerId: this.customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { count: 0, publishedAppIds: [] };
    }
  }
}
