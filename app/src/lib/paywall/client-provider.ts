/**
 * Client-Side Paywall Data Provider
 *
 * Implementation of PaywallDataProvider for browser/client-side environment.
 * Used by non-React contexts (e.g., publishAction) that need paywall checks.
 *
 * For React components, prefer usePaywallEligibility hook which uses
 * React Query for automatic caching and deduplication.
 */

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { getRootDomain } from '@/utils/getRootDomain';
import type { AccountSubscription, PaywallDataProvider, SwitchboardFlagsResult } from './providers';
import { PAYWALL_CONFIG, type ProjectEdge } from './shared';

/**
 * Client-side implementation of paywall data provider
 *
 * This implementation:
 * - Uses appFetch() to call Next.js API routes
 * - Uses window.location for root domain extraction
 * - Relies on browser cookies for authentication (credentials: 'include')
 */
export class ClientPaywallProvider implements PaywallDataProvider {

  /**
   * Get root domain from window.location
   *
   * Uses the shared getRootDomain() utility which extracts the root domain
   * from the current URL and transforms 'ote' to 'stg' for staging environments.
   *
   * @returns Root domain or null if running server-side
   */
  getRootDomain(): string | null {
    return getRootDomain();
  }

  /**
   * Check switchboard feature flags
   *
   * Calls the switchboard API directly with browser credentials.
   * Uses fetch with credentials: 'include' to send auth cookies.
   *
   * @param rootDomain - The root domain to construct switchboard URLs
   * @returns Promise with both flag states
   * @throws Error if flag fetch fails or JSON parsing fails
   */
  async checkSwitchboardFlags(rootDomain: string): Promise<SwitchboardFlagsResult> {
    const { SWITCHBOARD_FLAGS, SWITCHBOARD_APP, BFF_HOST_PREFIX } = PAYWALL_CONFIG;

    const paywallFlagUrl = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/${SWITCHBOARD_FLAGS.PAYWALL}?app=${SWITCHBOARD_APP}`;
    const marketsFlagUrl = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/${SWITCHBOARD_FLAGS.MARKETS}?app=${SWITCHBOARD_APP}`;

    const [paywallResponse, marketsResponse] = await Promise.all([
      fetch(paywallFlagUrl, { credentials: 'include' }),
      fetch(marketsFlagUrl, { credentials: 'include' }),
    ]);

    // Fail closed: Throw error if flag fetch fails
    // This ensures we show "service unavailable" rather than "you need to pay"
    // The error will be caught by core.ts and return proper "unable to verify" message
    if (!paywallResponse.ok) {
      logger.error('paywall.client-provider.flag-fetch.failure', {
        flag: SWITCHBOARD_FLAGS.PAYWALL,
        status: paywallResponse.status,
        url: paywallFlagUrl,
      });
      throw new Error(
        `Switchboard flag fetch failed: ${SWITCHBOARD_FLAGS.PAYWALL} (status: ${paywallResponse.status})`
      );
    }

    if (!marketsResponse.ok) {
      logger.error('paywall.client-provider.flag-fetch.failure', {
        flag: SWITCHBOARD_FLAGS.MARKETS,
        status: marketsResponse.status,
        url: marketsFlagUrl,
      });
      throw new Error(
        `Switchboard flag fetch failed: ${SWITCHBOARD_FLAGS.MARKETS} (status: ${marketsResponse.status})`
      );
    }

    // Parse flag responses with error handling
    let paywallFlag: boolean;
    let marketsFlag: boolean;

    try {
      const paywallData = await paywallResponse.json();
      paywallFlag = paywallData.setting ?? false;
    } catch (error) {
      logger.error('paywall.client-provider.flag-parse.failure', {
        flag: SWITCHBOARD_FLAGS.PAYWALL,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to parse switchboard flag: ${SWITCHBOARD_FLAGS.PAYWALL} - ${error instanceof Error ? error.message : String(error)}`
      );
    }

    try {
      const marketsData = await marketsResponse.json();
      marketsFlag = marketsData.setting ?? false;
    } catch (error) {
      logger.error('paywall.client-provider.flag-parse.failure', {
        flag: SWITCHBOARD_FLAGS.MARKETS,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to parse switchboard flag: ${SWITCHBOARD_FLAGS.MARKETS} - ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return {
      paywall: paywallFlag,
      markets: marketsFlag,
    };
  }

  /**
   * Get account-level subscription (app-agnostic)
   *
   * Calls /api/subscription to get the user's subscription.
   *
   * @returns Promise with account subscription data
   */
  async getAccountSubscription(): Promise<AccountSubscription | undefined> {
    const response = await appFetch('/api/subscription', {
      credentials: 'include',
    });

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json();
    return data?.data?.subscription;
  }

  /**
   * Get subscription ID for an app (deprecated - use getAccountSubscription)
   *
   * Calls /api/apps/[id]/subscription which uses the authenticated user's
   * credentials to find the subscription containing the app.
   *
   * @param appId - The app ID to find subscription for
   * @returns Promise with subscription ID or undefined
   * @deprecated Use getAccountSubscription() for app-agnostic subscriptions
   */
  async getSubscription(appId: string): Promise<string | undefined> {
    const response = await appFetch(`/api/apps/${appId}/subscription`, {
      credentials: 'include',
    });

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json();
    return data?.data?.subscription?.id;
  }

  /**
   * Get entitlements for a subscription
   *
   * Calls /api/entitlements which returns the subscription with entitlement info.
   *
   * @param subscriptionId - The subscription ID to check
   * @returns Promise with entitlement ID or undefined
   */
  async getEntitlements(subscriptionId: string): Promise<string | undefined> {
    const response = await appFetch(
      `/api/entitlements?subscriptionId=${encodeURIComponent(subscriptionId)}`,
      {
        credentials: 'include',
      }
    );

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json();
    return data?.data?.subscription?.entitlementId;
  }

  /**
   * Get user's projects
   *
   * Calls /api/projects to get the user's projects.
   *
   * @returns Promise with array of project edges
   */
  async getProjects(): Promise<ProjectEdge[]> {
    const response = await appFetch('/api/projects', {
      credentials: 'include',
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data?.data?.projects?.edges || [];
  }
}
