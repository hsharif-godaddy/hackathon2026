/**
 * Server-Side Paywall Data Provider
 *
 * Implementation of PaywallDataProvider for server/Node.js environment.
 * Uses direct service clients and explicit JWT authentication.
 */

import { AIRO_OWNER_PRODUCTS, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { VentureService } from '@/lib/venture-service';
import type { PaywallDataProvider, SwitchboardFlagsResult } from './providers';
import { PAYWALL_CONFIG, type ProjectEdge } from './shared';

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
   * Extracts the root domain from the Host header and transforms
   * 'ote' to 'stg' for staging environments.
   *
   * For local development (localhost or 127.0.0.1), returns a fallback
   * domain from the PAYWALL_DEV_DOMAIN environment variable, or defaults
   * to 'test-godaddy.com'.
   *
   * @returns Root domain or null if header not found
   */
  getRootDomain(): string | null {
    const host = this.headers.get('host');

    if (!host) {
      logger.warn('paywall.server-provider.no-host-header', {
        message: 'Host header is missing or null',
      });
      return null;
    }

    // Strip port number if present (e.g., "example.com:8443" -> "example.com")
    const hostWithoutPort = host.split(':')[0];

    // Development fallback for local development domains
    // Matches: localhost, 127.0.0.1, local.gasket.dev-godaddy.com
    if (
      hostWithoutPort.startsWith('localhost') ||
      hostWithoutPort.startsWith('127.0.0.1') ||
      hostWithoutPort === 'local.gasket.dev-godaddy.com'
    ) {
      const fallbackDomain = process.env.PAYWALL_DEV_DOMAIN || 'dev-godaddy.com';
      logger.info('paywall.server-provider.local-dev-fallback', {
        host: hostWithoutPort,
        fallbackDomain,
      });
      return fallbackDomain;
    }

    // Extract root domain (e.g., "builder.test-godaddy.com" -> "test-godaddy.com")
    const matches = hostWithoutPort.match(/([\w-]+\.\w+)$/);
    return matches ? matches[0].replace('ote', 'stg') : null;
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

    const [paywallResponse, marketsResponse] = await Promise.all([
      fetch(paywallFlagUrl, {
        headers: {
          'Authorization': `sso-jwt ${this.jwt}`
        },
      }),
      fetch(marketsFlagUrl, {
        headers: {
          'Authorization': `sso-jwt ${this.jwt}`
        },
      }),
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

    return {
      paywall: paywallFlag,
      markets: marketsFlag,
    };
  }

  /**
   * Get subscription ID for an app
   *
   * Searches through all subscriptions, systems, and apps to find the
   * subscription containing the specified app.
   *
   * This is more complex than the client implementation because we need
   * to use the mgmt-airo client directly instead of an API route.
   *
   * @param appId - The app ID to find subscription for
   * @returns Promise with subscription ID or undefined
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
   * Uses VentureService to fetch customer projects with billing information.
   *
   * @returns Promise with array of project edges
   */
  async getProjects(): Promise<ProjectEdge[]> {
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
}
