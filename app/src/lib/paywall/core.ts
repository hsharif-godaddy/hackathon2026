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
import { isMatchingProject, isPaidPlan, type PaywallCheckResult } from './shared';

/**
 * Check if user has Airo Plus access (app-agnostic)
 *
 * This is the main paywall eligibility check used by both client and server.
 * It follows a 4-step algorithm:
 *
 * 1. Check if paywall is enabled via switchboard flags
 *    - If check fails (network error, service down), throw error and deny access (fail closed)
 *    - If paywall explicitly disabled by flags, allow access
 *
 * 2. Get user's account-level subscription
 *    - Check the plan field (none|free|starter|airoPlus)
 *    - Free and none plans require paywall
 *    - Starter and airoPlus plans have access
 *
 * 3. Check if user has entitlements (for legacy compatibility)
 *    - If yes, grant access
 *
 * 4. Fallback: Check for matching Airo Plus project
 *    - If found, grant access
 *    - Otherwise, deny access
 *
 * @param provider - Environment-specific data provider
 * @param appId - Optional app ID for legacy compatibility
 * @returns Promise with detailed access result
 */
export async function checkPaywallEligibility(
  provider: PaywallDataProvider,
  appId?: string
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
      logger.error('paywall.eligibility.no-root-domain', {
        appId,
        message: 'Cannot check switchboard flags without root domain',
      });
      // Fail closed - deny access if we can't determine domain
      // Security: Never grant access when we can't verify eligibility
      return {
        hasAccess: false,
        reason: 'Unable to verify subscription status (no root domain)',
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
      // Fail closed - deny access if switchboard check fails
      // Security: Never grant access when we can't verify paywall status
      return {
        hasAccess: false,
        reason: 'Unable to verify subscription status (switchboard check failed)',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      };
    }

    if (!paywallEnabled) {
      // Switchboard flags explicitly indicate paywall is disabled
      // This is intentional configuration (not a failure - those throw errors)
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

    // Step 2: Check account-level subscription
    const accountSubscription = await provider.getAccountSubscription();

    if (!accountSubscription) {
      logger.warn('paywall.eligibility.no-subscription', { appId });
      result.reason = 'No active subscription found';
      return result;
    }

    // Check plan level for access
    const hasAccessByPlan = isPaidPlan(accountSubscription.plan);

    if (hasAccessByPlan) {
      result.details.hasSubscription = true;
      result.details.subscriptionId = accountSubscription.id;
      result.hasAccess = true;

      logger.info('paywall.eligibility.access-granted', {
        appId,
        reason: 'user-has-paid-plan',
        subscriptionId: accountSubscription.id,
        plan: accountSubscription.plan,
      });

      return result;
    }

    // If user has free or none plan, check entitlements and projects in parallel
    result.details.hasSubscription = true;
    result.details.subscriptionId = accountSubscription.id;

    // Step 3 & 4: Check entitlements and projects in parallel for faster response
    const [entitlementResult, projectsResult] = await Promise.allSettled([
      accountSubscription.id ? provider.getEntitlements(accountSubscription.id) : Promise.resolve(undefined),
      provider.getProjects(),
    ]);

    // Check entitlements result
    if (entitlementResult.status === 'fulfilled' && entitlementResult.value) {
      result.details.hasEntitlements = true;
      result.details.entitlementId = entitlementResult.value;
      result.hasAccess = true;

      logger.info('paywall.eligibility.access-granted', {
        appId,
        reason: 'user-has-entitlements',
        subscriptionId: accountSubscription.id,
        entitlementId: entitlementResult.value,
      });

      return result;
    }

    if (entitlementResult.status === 'rejected') {
      logger.warn('paywall.eligibility.entitlements-error', {
        appId,
        subscriptionId: accountSubscription.id,
        error: entitlementResult.reason instanceof Error ? entitlementResult.reason.message : String(entitlementResult.reason),
      });
    }

    // Check projects result
    if (projectsResult.status === 'fulfilled') {
      const projects = projectsResult.value;
      const matchingProject = projects.find((edge) => isMatchingProject(edge.node));

      if (matchingProject?.node?.billing?.id) {
        result.details.hasMatchingProject = true;
        result.details.billingId = matchingProject.node.billing.id;
        result.hasAccess = true;

        logger.info('paywall.eligibility.access-granted', {
          appId,
          reason: 'user-has-matching-project',
          subscriptionId: accountSubscription.id,
          billingId: matchingProject.node.billing.id,
        });

        return result;
      }
    } else {
      logger.warn('paywall.eligibility.projects-error', {
        appId,
        subscriptionId: accountSubscription.id,
        error: projectsResult.reason instanceof Error ? projectsResult.reason.message : String(projectsResult.reason),
      });
    }

    // No access found
    logger.warn('paywall.eligibility.access-denied', {
      appId,
      subscriptionId: accountSubscription.id,
      plan: accountSubscription.plan
    });
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
