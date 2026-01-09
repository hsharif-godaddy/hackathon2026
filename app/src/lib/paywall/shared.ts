/**
 * Shared Paywall Configuration and Types
 *
 * This module contains shared constants, types, and helper functions
 * used by both client-side and server-side paywall implementations.
 */

/**
 * Paywall feature flag and configuration constants
 */
export const PAYWALL_CONFIG = {
  /**
   * Switchboard feature flags for paywall control
   */
  SWITCHBOARD_FLAGS: {
    PAYWALL: 'appbuilder-airoplus-paywall',
    MARKETS: 'appbuilder-airoplus-markets',
  },
  /**
   * Application identifier for switchboard
   */
  SWITCHBOARD_APP: 'airo-app-builder',
  /**
   * BFF host prefix for switchboard API calls
   */
  BFF_HOST_PREFIX: 'bff.pcx',
  /**
   * Criteria for matching Airo Plus projects
   */
  PROJECT_MATCH_CRITERIA: {
    GROUP: 'aigeneratedmedia',
    STATUS: 'ACTIVE',
    PLAN: 'logoImage',
  },
} as const;

/**
 * Detailed breakdown of paywall check results
 */
export interface PaywallCheckDetails {
  /** User has an active subscription */
  hasSubscription: boolean;
  /** User has entitlements for Airo Plus */
  hasEntitlements: boolean;
  /** User has a matching project (fallback access method) */
  hasMatchingProject: boolean;
  /** Subscription ID if found */
  subscriptionId?: string;
  /** Entitlement ID if found */
  entitlementId?: string;
  /** Billing ID from matching project if found */
  billingId?: string;
}

/**
 * Result of paywall eligibility check
 */
export interface PaywallCheckResult {
  /** Whether user has access to publish */
  hasAccess: boolean;
  /** Human-readable reason for denial (if applicable) */
  reason?: string;
  /** Detailed breakdown of check results */
  details: PaywallCheckDetails;
}

/**
 * Project edge from GraphQL response
 */
export interface ProjectEdge {
  node: {
    group: string;
    status: string;
    billing?: {
      id: string;
      plan: string;
    };
  };
}

/**
 * Check if a project matches Airo Plus criteria
 *
 * @param node - Project node to check
 * @returns True if project grants Airo Plus access
 */
export function isMatchingProject(node: ProjectEdge['node']): boolean {
  const { PROJECT_MATCH_CRITERIA } = PAYWALL_CONFIG;

  return (
    node.group === PROJECT_MATCH_CRITERIA.GROUP &&
    node.status === PROJECT_MATCH_CRITERIA.STATUS &&
    node.billing?.plan === PROJECT_MATCH_CRITERIA.PLAN
  );
}
