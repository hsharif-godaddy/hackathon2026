/**
 * Core Paywall Eligibility Algorithm
 *
 * This module contains the main business logic for determining whether a user
 * has access to publish via Airo Plus subscription.
 *
 * The algorithm is environment-agnostic and uses a provider interface to access
 * data, allowing it to work in both client (browser) and server (Node.js) contexts.
 */

import { canPublishWithPlan, getPublishLimit } from '@/lib/publish-limit';
import { logger } from '@/lib/request-context';
import type { PaywallDataProvider, SwitchboardFlagsResult } from './providers';
import { getEffectivePlan, isPaidPlanForGrants, type PaywallCheckResult, PaywallDenialReason } from './shared';

/**
 * Action types for paywall eligibility check
 */
export enum PaywallAction {
  Publish = 'publish',
  Download = 'download',
}

/**
 * Check if user has Airo Plus access (app-agnostic)
 *
 * This is the main paywall eligibility check used by both client and server.
 *
 * 1. Fetch the bypass-publish-limit operational flag
 * 2. Get user's account-level subscription and check plan
 *    - Paid plan (Starter, Professional, Ultimate) = access granted with plan limits
 *    - Users with app-builder-bypass-publish-limit enabled get unlimited publishing
 *    - Non-paid plans (Free, None, AiroPlus) = paywall
 *
 * @param provider - Environment-specific data provider
 * @param appId - Optional app ID for legacy compatibility
 * @param action - Action being checked ('publish' | 'download'). Publish limits only apply to 'publish'.
 * @returns Promise with detailed access result
 */
export async function checkPaywallEligibility(
  provider: PaywallDataProvider,
  appId?: string,
  action: PaywallAction = PaywallAction.Publish
): Promise<PaywallCheckResult> {
  logger.info('paywall.eligibility.check.start', { appId, action });

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
    // Step 1: Fetch bypassPublishLimit flag
    const rootDomain = provider.getRootDomain();

    let flags: SwitchboardFlagsResult;
    try {
      flags = await provider.checkSwitchboardFlags(rootDomain || '');

      logger.info('paywall.eligibility.switchboard.checked', {
        appId,
        isBypassEnabled: flags.bypassPublishLimit,
      });
    } catch (error) {
      logger.error('paywall.eligibility.switchboard.check-failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fail closed on switchboard error, but default bypassPublishLimit to false
      flags = { bypassPublishLimit: false };
    }

    // Step 2: Check account-level subscription
    const accountSubscription = await provider.getAccountSubscription();

    if (!accountSubscription) {
      logger.warn('paywall.eligibility.no-subscription', { appId });
      result.reason = 'No active subscription found';
      return result;
    }

    result.details.hasSubscription = true;
    result.details.subscriptionId = accountSubscription.id;

    const hasAccessByPlan = isPaidPlanForGrants(accountSubscription.plan);
    if (hasAccessByPlan) {
      result.details.hasSubscription = true;
      result.details.subscriptionId = accountSubscription.id;

      if (action === PaywallAction.Publish && !flags.bypassPublishLimit) {

        let publishedApps;
        try {
          publishedApps = await provider.getPublishedApps();
        } catch (error) {
          logger.error('paywall.eligibility.published-apps.check-failed', {
            appId,
            subscriptionId: accountSubscription.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // Fail closed - deny access if we can't verify publish count
          return {
            hasAccess: false,
            reason: 'Unable to verify publish limit',
            details: {
              hasSubscription: true,
              subscriptionId: accountSubscription.id,
              hasEntitlements: false,
              hasMatchingProject: false,
            },
          };
        }

        const effectivePlan = getEffectivePlan(accountSubscription.plan, accountSubscription.hadAiroPlus);
        const limit = getPublishLimit(effectivePlan);
        const canPublish = canPublishWithPlan(
          effectivePlan,
          publishedApps.count,
          appId,
          publishedApps.publishedAppIds
        );

        if (!canPublish) {
          logger.warn('paywall.eligibility.publish-limit-reached', {
            appId,
            plan: accountSubscription.plan,
            currentCount: publishedApps.count,
            limit,
          });

          return {
            hasAccess: false,
            reason: PaywallDenialReason.PublishLimitReached,
            details: {
              hasSubscription: true,
              subscriptionId: accountSubscription.id,
              hasEntitlements: false,
              hasMatchingProject: false,
              publishLimit: limit,
              publishedCount: publishedApps.count,
            },
          };
        }

        logger.info('paywall.eligibility.access-granted', {
          appId,
          reason: 'user-has-paid-plan-under-limit',
          subscriptionId: accountSubscription.id,
          plan: accountSubscription.plan,
          currentCount: publishedApps.count,
          limit,
        });
      } else {
        logger.info('paywall.eligibility.access-granted', {
          appId,
          reason: 'user-has-paid-plan',
          subscriptionId: accountSubscription.id,
          plan: accountSubscription.plan,
        });
      }

      result.hasAccess = true;
      return result;
    }

    // User does not have a paid plan — require upgrade
    result.reason = 'Subscription upgrade required';
    return result;
  } catch (error) {
    logger.error('paywall.eligibility.check-failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });

    // Fail closed - deny access if check fails
    result.hasAccess = false;
    result.reason = 'Unable to verify subscription status';
    return result;
  }
}
