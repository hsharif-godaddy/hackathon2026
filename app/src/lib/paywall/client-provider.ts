/**
 * Client-Side Paywall Data Provider
 *
 * Implementation of PaywallDataProvider for browser/client-side environment.
 * Uses browser-specific APIs and Next.js API routes for data access.
 */

import { appFetch } from '@/lib/gasket-config';
import { getRootDomain } from '@/utils/getRootDomain';

import type { PaywallDataProvider, SwitchboardFlagsResult } from './providers';
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
   */
  async checkSwitchboardFlags(rootDomain: string): Promise<SwitchboardFlagsResult> {
    const { SWITCHBOARD_FLAGS, SWITCHBOARD_APP, BFF_HOST_PREFIX } = PAYWALL_CONFIG;

    const paywallFlagUrl = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/${SWITCHBOARD_FLAGS.PAYWALL}?app=${SWITCHBOARD_APP}`;
    const marketsFlagUrl = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/${SWITCHBOARD_FLAGS.MARKETS}?app=${SWITCHBOARD_APP}`;

    const [paywallResponse, marketsResponse] = await Promise.all([
      fetch(paywallFlagUrl, { credentials: 'include' }),
      fetch(marketsFlagUrl, { credentials: 'include' }),
    ]);

    const paywallFlag = paywallResponse.ok
      ? (await paywallResponse.json()).setting ?? false
      : false;
    const marketsFlag = marketsResponse.ok
      ? (await marketsResponse.json()).setting ?? false
      : false;

    return {
      paywall: paywallFlag,
      markets: marketsFlag,
    };
  }

  /**
   * Get subscription ID for an app
   *
   * Calls /api/apps/[id]/subscription which uses the authenticated user's
   * credentials to find the subscription containing the app.
   *
   * @param appId - The app ID to find subscription for
   * @returns Promise with subscription ID or undefined
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
   * Calls /api/projects which returns the authenticated user's projects
   * with billing information.
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
