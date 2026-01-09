/**
 * Core Paywall Eligibility Algorithm
 *
 * This module contains the main business logic for determining whether a user
 * has access to publish via Airo Plus subscription.
 *
 * The algorithm is environment-agnostic and uses a provider interface to access
 * data, allowing it to work in both client (browser) and server (Node.js) contexts.
 */

import { logger } from '@/lib/request-context';

import type { PaywallDataProvider } from './providers';
import { isMatchingProject, PAYWALL_CONFIG, type PaywallCheckResult } from './shared';

/**
 * Check if user has Airo Plus access for an app
 *
 * This is the main paywall eligibility check used by both client and server.
 * It follows a 4-step algorithm:
 *
 * 1. Check if paywall is enabled via switchboard flags
 *    - If disabled, allow access (fail open)
 *
 * 2. Verify user has a subscription containing the app
 *    - If no subscription, deny access
 *
 * 3. Check if user has entitlements
 *    - If yes, grant access
 *
 * 4. Fallback: Check for matching Airo Plus project
 *    - If found, grant access
 *    - Otherwise, deny access
 *
 * @param appId - The app ID to check access for
 * @param provider - Environment-specific data provider
 * @returns Promise with detailed access result
 */
export async function checkPaywallEligibility(
  appId: string,
  provider: PaywallDataProvider
): Promise<PaywallCheckResult> {
  logger.info('paywall.eligibility.check.start', { appId });

  // Initialize result structure
  const result: PaywallCheckResult = {
    hasAccess: false,
    details: {
      hasSubscription: false,
      hasEntitlements: false,
      hasMatchingProject: false,
    },
  };

  try {
    // Step 1: Check if paywall is enabled via switchboard flags
    const rootDomain = provider.getRootDomain();

    if (!rootDomain) {
      logger.warn('paywall.eligibility.no-root-domain', {
        appId,
        message: 'Cannot check switchboard flags without root domain',
      });
      // Fail open - allow access if we can't determine domain
      // This prevents blocking legitimate users in edge cases
      return {
        hasAccess: true,
        reason: 'Paywall check skipped (no root domain)',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      };
    }

    let paywallEnabled: boolean;
    try {
      const flags = await provider.checkSwitchboardFlags(rootDomain);
      paywallEnabled = flags.paywall && flags.markets;

      logger.info('paywall.eligibility.switchboard.checked', {
        appId,
        isPaywallEnabled: flags.paywall,
        isPaywallEnabledInMarket: flags.markets,
      });
    } catch (error) {
      logger.error('paywall.eligibility.switchboard.check-failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fail open - allow if switchboard check fails
      return {
        hasAccess: true,
        reason: 'Paywall not enabled (switchboard check failed)',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      };
    }

    if (!paywallEnabled) {
      logger.info('paywall.eligibility.disabled', { appId });
      return {
        hasAccess: true,
        reason: 'Paywall not enabled',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      };
    }

    // Step 2: Check subscription
    const subscriptionId = await provider.getSubscription(appId);

    if (!subscriptionId) {
      logger.warn('paywall.eligibility.no-subscription', { appId });
      result.reason = 'No active subscription found';
      return result;
    }

    result.details.hasSubscription = true;
    result.details.subscriptionId = subscriptionId;

    // Step 3: Check entitlements
    try {
      const entitlementId = await provider.getEntitlements(subscriptionId);

      if (entitlementId) {
        result.details.hasEntitlements = true;
        result.details.entitlementId = entitlementId;
        result.hasAccess = true;

        logger.info('paywall.eligibility.access-granted', {
          appId,
          reason: 'user-has-entitlements',
          subscriptionId,
          entitlementId,
        });

        return result;
      }
    } catch (error) {
      logger.warn('paywall.eligibility.entitlements-error', {
        appId,
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue to fallback check
    }

    // Step 4: Check matching project (fallback)
    try {
      const projects = await provider.getProjects();

      const matchingProject = projects.find((edge) => isMatchingProject(edge.node));

      if (matchingProject?.node?.billing?.id) {
        result.details.hasMatchingProject = true;
        result.details.billingId = matchingProject.node.billing.id;
        result.hasAccess = true;

        logger.info('paywall.eligibility.access-granted', {
          appId,
          reason: 'user-has-matching-project',
          subscriptionId,
          billingId: matchingProject.node.billing.id,
        });

        return result;
      }
    } catch (error) {
      logger.warn('paywall.eligibility.projects-error', {
        appId,
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue to denial
    }

    // No access found
    logger.warn('paywall.eligibility.access-denied', { appId, subscriptionId });
    result.reason = 'Airo Plus subscription required';
    return result;
  } catch (error) {
    logger.error('paywall.eligibility.check-failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Fail closed - deny access if check fails
    result.hasAccess = false;
    result.reason = 'Unable to verify subscription status';
    return result;
  }
}
