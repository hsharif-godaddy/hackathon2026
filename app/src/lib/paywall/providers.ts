/**
 * Paywall Data Provider Interface
 *
 * This interface defines the contract for accessing paywall-related data.
 * Different environments (client/server) implement this interface to provide
 * data access using environment-appropriate methods.
 *
 * This abstraction allows the core paywall logic to be environment-agnostic.
 */

import type { SiteInfo } from '@/lib/control-plane/types';
import { SubscriptionPlan } from '@/types/credits';
import type { ProjectEdge } from './shared';

/**
 * Switchboard feature flag check result
 */
export interface SwitchboardFlagsResult {
  /** Whether the main paywall flag is enabled */
  paywall: boolean;
  /** Whether paywall is enabled in the current market */
  markets: boolean;
  /** Whether app-builder-bypass-publish-limit flag is enabled allowing unlimited publishing.
   * Defaults to false on fetch failure for fail-closed behavior. */
  bypassPublishLimit: boolean;
}

/**
 * Published apps data for limit checking
 */
export interface PublishedAppsData {
  /** Number of currently published apps */
  count: number;
  /** IDs of published apps (for re-publish check) */
  publishedAppIds: string[];
  /** Published apps data for UI display (only populated client-side) */
  apps?: SiteInfo[];
}

/**
 * Account subscription data structure
 */
export interface AccountSubscription {
  id?: string;
  productId?: string;
  customerId?: string;
  status?: string;
  isTrial?: boolean;
  entitlementId?: string; // Airo Plus entitlement
  builderEntitlementId?: string; // Airo Builder entitlement
  hadAiroPlus?: boolean; // Whether user previously had Airo Plus
  plan?: SubscriptionPlan;
  renewsAt?: string;
}

/**
 * Provider interface for paywall data access
 *
 * Implementations must handle environment-specific details like:
 * - Authentication (browser cookies vs JWT tokens)
 * - API access (API routes vs direct service clients)
 * - Domain extraction (window.location vs request headers)
 */
export interface PaywallDataProvider {
  /**
   * Get the root domain for switchboard API calls
   *
   * Client: Extracts from window.location.hostname
   * Server: Parses from request headers
   *
   * @returns Root domain (e.g., 'test-godaddy.com') or null if unavailable
   */
  getRootDomain(): string | null;

  /**
   * Check switchboard feature flags for paywall control
   *
   * Client: Uses fetch with 'credentials: include'
   * Server: Uses fetch with explicit JWT in headers
   *
   * @param rootDomain - The root domain to check flags for
   * @returns Promise with both flag states
   */
  checkSwitchboardFlags(rootDomain: string): Promise<SwitchboardFlagsResult>;

  /**
   * Get account-level subscription (app-agnostic)
   *
   * Client: Calls /api/subscription API route
   * Server: Uses AiroMgmtClient to get customer's subscription
   *
   * @returns Promise with account subscription data
   */
  getAccountSubscription(): Promise<AccountSubscription | undefined>;

  /**
   * Get subscription ID for an app (deprecated - use getAccountSubscription)
   *
   * Client: Calls /api/apps/[id]/subscription API route
   * Server: Uses AiroMgmtClient to search through subscriptions/systems/apps
   *
   * @param appId - The app ID to find subscription for
   * @returns Promise with subscription ID or undefined if not found
   * @deprecated Use getAccountSubscription() for app-agnostic subscriptions
   */
  getSubscription(appId: string): Promise<string | undefined>;

  /**
   * Get entitlements for a subscription
   *
   * Client: Calls /api/entitlements API route
   * Server: Uses AiroMgmtClient.getEntitlements()
   *
   * @param subscriptionId - The subscription ID to check entitlements for
   * @returns Promise with entitlement ID or undefined if no entitlements
   */
  getEntitlements(subscriptionId: string): Promise<string | undefined>;

  /**
   * Get user's projects to check for matching Airo Plus projects
   *
   * Client: Calls /api/projects API route
   * Server: Uses VentureService.getCustomerProjects()
   *
   * @returns Promise with array of project edges
   */
  getProjects(): Promise<ProjectEdge[]>;

  /**
   * Get published apps data for limit checking
   *
   * @returns Promise with published apps count and IDs
   */
  getPublishedApps(): Promise<PublishedAppsData>;
}
