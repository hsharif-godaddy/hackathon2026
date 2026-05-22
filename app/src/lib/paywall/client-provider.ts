/**
 * Client-Side Paywall Data Provider
 *
 * Implementation of PaywallDataProvider for browser/client-side environment.
 * Used by non-React contexts (e.g., publishAction) that need paywall checks.
 *
 * For React components, prefer usePaywallEligibility hook which uses
 * React Query for automatic caching and deduplication.
 */

import { getSwitchboardFlag } from '@/hooks/useSwitchboard';
import type { SiteInfo } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { filterPublishedApps } from '@/lib/publish-limit';
import { logger } from '@/lib/request-context';
import { getRootDomain } from '@/utils/getRootDomain';
import type { AccountSubscription, PaywallDataProvider, PublishedAppsData, SwitchboardFlagsResult } from './providers';
import { type ProjectEdge } from './shared';

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
   * Read the bypass-publish-limit flag from the SSR-serialized gasket-data tree.
   *
   * The paywall is always enabled (no longer gated by feature flags).
   * Only the bypass-publish-limit flag is still read as an operational escape hatch.
   */
  async checkSwitchboardFlags(_rootDomain: string): Promise<SwitchboardFlagsResult> {
    const bypassPublishLimit = getSwitchboardFlag('app-builder-bypass-publish-limit') ?? false;
    return { bypassPublishLimit };
  }

  /**
   * Get account-level subscription (app-agnostic)
   *
   * Calls /api/subscriptions to get the user's subscription.
   * Returns undefined only when user genuinely has no subscription (404).
   * Throws on server errors to ensure fail-closed behavior.
   *
   * @returns Promise with account subscription data, or undefined if no subscription exists
   * @throws Error on server errors (5xx) to ensure fail-closed behavior
   */
  async getAccountSubscription(): Promise<AccountSubscription | undefined> {
    const response = await appFetch('/api/subscriptions', {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 404) {
        return undefined;
      }

      logger.error('paywall.client-provider.subscription.fetch-failed', {
        status: response.status,
      });
      throw new Error(`Failed to fetch subscription: ${response.status}`);
    }

    const data = await response.json();
    return data?.data?.active;
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
   * Calls /api/projects which returns empty results (grants always enabled).
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

  /**
   * Get published apps data
   *
   * Calls /api/sites and filters for apps with active 'publish' variant.
   * Throws on error to ensure fail-closed behavior for publish limit checks.
   *
   * @returns Promise with published apps count, IDs, and app info for UI display
   * @throws Error if unable to fetch published apps (fail-closed for security)
   */
  async getPublishedApps(): Promise<PublishedAppsData> {
    const response = await appFetch('/api/sites', {
      credentials: 'include',
    });

    if (!response.ok) {
      logger.error('paywall.client-provider.published-apps.fetch-failed', {
        status: response.status,
      });
      throw new Error(`Failed to fetch published apps: ${response.status}`);
    }

    const sites: SiteInfo[] = await response.json();
    const publishedApps = filterPublishedApps(sites);

    return {
      count: publishedApps.length,
      publishedAppIds: publishedApps.map(app => app.id),
      apps: publishedApps,
    };
  }
}
