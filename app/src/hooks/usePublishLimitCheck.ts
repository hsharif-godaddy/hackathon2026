/**
 * Publish Limit Check Hook
 *
 * Combines feature flags, subscription info, and published apps count
 * to determine if a user can publish their app.
 */

import { useMemo } from 'react';

import { getEffectivePlan } from '@/lib/paywall/shared';
import {
  canPublishWithPlan,
  getPublishLimit,
  type PublishLimitResult,
} from '@/lib/publish-limit';
import { SubscriptionPlan } from '@/types/credits';
import { usePublishedApps } from './usePublishedApps';
import { useSubscription } from './useSubscription';
import { useSwitchboard } from './useSwitchboard';

interface UsePublishLimitCheckOptions {
  /** The app ID being published (used to check if re-publishing) */
  currentAppId?: string;
  /** Whether to enable the publish limit check (default: true) */
  enabled?: boolean;
}

interface UsePublishLimitCheckResult extends PublishLimitResult {
  /** Whether the check is still loading */
  isLoading: boolean;
  /** Whether there was an error loading data */
  isError: boolean;
  /** Refetch all data */
  refetch: () => void;
}

/**
 * Hook to check if a user can publish based on their subscription plan and current publish count
 *
 * When app-builder-grants is enabled:
 * - Legacy AiroPlus users (Starter plan with hadAiroPlus) = 9 apps
 * - New users are limited by plan:
 *   - Free = 0 apps (show paywall)
 *   - Starter = 1 app
 *   - Professional = 10 apps
 *   - Ultimate = 50 apps
 *
 * When app-builder-bypass-publish-limit is enabled, all limits are bypassed.
 *
 * @param options - Optional configuration
 * @returns Publish limit check result
 */
export function usePublishLimitCheck(
  options: UsePublishLimitCheckOptions = {}
): UsePublishLimitCheckResult {
  const { currentAppId, enabled = true } = options;

  // Feature flags - only fetch when enabled
  const { data: isGrantsEnabled, isLoading: isGrantsLoading } = useSwitchboard('app-builder-grants', { enabled });
  const { data: isBypassEnabled, isLoading: isBypassLoading } = useSwitchboard('app-builder-bypass-publish-limit', { enabled });

  // Subscription data - only fetch when enabled
  const {
    data: subscription,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
    refetch: refetchSubscription,
  } = useSubscription();

  // Published apps data - only fetch when enabled and grants feature is enabled
  const {
    publishedApps,
    count: publishedCount,
    isLoading: isPublishedAppsLoading,
    isError: isPublishedAppsError,
    refetch: refetchPublishedApps,
  } = usePublishedApps({ enabled: enabled && isGrantsEnabled === true });

  const isWaitingForSites = isGrantsEnabled === true && isPublishedAppsLoading;

  const isLoading = enabled && (isGrantsLoading || isBypassLoading || isSubscriptionLoading || isWaitingForSites);
  const isError = enabled && (isSubscriptionError || (isGrantsEnabled === true && isPublishedAppsError));

  const result = useMemo((): PublishLimitResult => {
    // Default result for loading/disabled state
    const defaultResult: PublishLimitResult = {
      canPublish: true,
      currentCount: publishedCount,
      limit: null,
      plan: subscription?.plan,
      publishedApps,
    };
    // If grants feature is disabled, allow publishing (legacy behavior)
    if (!isGrantsEnabled) {
      return defaultResult;
    }

    // If bypass flag is enabled, allow publishing
    if (isBypassEnabled) {
      return defaultResult;
    }

    if (isPublishedAppsLoading) {
      return {
        ...defaultResult,
        canPublish: false,
      };
    }

    const plan = getEffectivePlan(subscription?.plan, subscription?.hadAiroPlus);

    // No plan, None, or Free plan - show paywall (limit: 0)
    if (!plan || plan === SubscriptionPlan.None || plan === SubscriptionPlan.Free) {
      return {
        canPublish: false,
        currentCount: publishedCount,
        limit: 0,
        plan,
        publishedApps,
      };
    }

    const limit = getPublishLimit(plan);
    const publishedAppIds = publishedApps.map(app => app.id);
    const canPublish = canPublishWithPlan(plan, publishedCount, currentAppId, publishedAppIds);

    if (!canPublish) {
      return {
        canPublish: false,
        currentCount: publishedCount,
        limit,
        plan,
        publishedApps,
      };
    }

    return {
      canPublish: true,
      currentCount: publishedCount,
      limit,
      plan,
      publishedApps,
    };
  }, [
    isGrantsEnabled,
    isBypassEnabled,
    isPublishedAppsLoading,
    subscription,
    publishedCount,
    publishedApps,
    currentAppId,
  ]);

  const refetch = () => {
    refetchSubscription();
    if (isGrantsEnabled) {
      refetchPublishedApps();
    }
  };

  return {
    ...result,
    isLoading,
    isError,
    refetch,
  };
}
