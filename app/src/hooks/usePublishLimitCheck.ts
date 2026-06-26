/**
 * Publish Limit Check Hook
 *
 * Combines feature flags, subscription info, and published apps count
 * to determine if a user can publish their app.
 */

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { hasActivePaidPlan } from '@/lib/paywall/shared';
import {
  evaluatePublishLimit,
  type PublishLimitResult,
} from '@/lib/publish-limit';
import { usePublishedApps } from './usePublishedApps';
import {
  type SubscriptionQueryData,
  SUBSCRIPTIONS_QUERY_KEY,
  useSubscription,
} from './useSubscription';
import { useSwitchboard } from './useSwitchboard';

/** Result of a forced-fresh publish confirmation (see {@link usePublishLimitCheck}). */
export interface ConfirmPublishResult extends PublishLimitResult {
  /** Account-level eligibility (active + grants-paid plan), computed from fresh data. */
  hasPaidPlan: boolean;
  /** Whether the forced refetch ended in an error state. */
  isError: boolean;
}

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
  /**
   * Force-fetch fresh subscription data (bypassing staleTime) and re-evaluate
   * the publish + account-level gates. Use on the publish critical path so a
   * transient thrown fetch error fails open rather than paywalling a paid user.
   * Latency is incurred only when the cached gate denies.
   */
  confirmCanPublish: () => Promise<ConfirmPublishResult>;
}

/**
 * Hook to check if a user can publish based on their subscription plan and current publish count
 *
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

  const isBypassEnabled = useSwitchboard('app-builder-bypass-publish-limit');

  // Subscription data - only fetch when enabled
  const {
    data: subscription,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
    refetch: refetchSubscription,
  } = useSubscription();

  // Published apps data - only fetch when enabled
  const {
    publishedApps,
    count: publishedCount,
    isLoading: isPublishedAppsLoading,
    isError: isPublishedAppsError,
    refetch: refetchPublishedApps,
  } = usePublishedApps({ enabled });

  const isLoading = enabled && (isSubscriptionLoading || isPublishedAppsLoading);
  const isError = enabled && (isSubscriptionError || isPublishedAppsError);

  const queryClient = useQueryClient();

  const result = useMemo((): PublishLimitResult => evaluatePublishLimit({
    subscriptionPlan: subscription?.plan,
    hadAiroPlus: subscription?.hadAiroPlus,
    publishedApps,
    publishedCount,
    currentAppId,
    isBypassEnabled,
    isPublishedAppsLoading,
  }), [
    isBypassEnabled,
    isPublishedAppsLoading,
    subscription,
    publishedCount,
    publishedApps,
    currentAppId,
  ]);

  const refetch = () => {
    refetchSubscription();
    refetchPublishedApps();
  };

  const confirmCanPublish = useCallback(async (): Promise<ConfirmPublishResult> => {
    // Force a fresh subscription fetch (ignores staleTime).
    await queryClient.refetchQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY });

    // Re-read from cache rather than captured render state to avoid a stale closure.
    const freshSubscription = queryClient.getQueryData<SubscriptionQueryData>(SUBSCRIPTIONS_QUERY_KEY);
    const freshActiveSubscription = freshSubscription?.active ?? undefined;
    // Only a *thrown* fetch error sets status:'error'; a 404→200+active:null is
    // a successful response and reads as unpaid (hasPaidPlan:false) below.
    const freshIsError =
      queryClient.getQueryState(SUBSCRIPTIONS_QUERY_KEY)?.status === 'error';

    const publishLimit = evaluatePublishLimit({
      subscriptionPlan: freshActiveSubscription?.plan,
      hadAiroPlus: freshActiveSubscription?.hadAiroPlus,
      publishedApps,
      publishedCount,
      currentAppId,
      isBypassEnabled,
      isPublishedAppsLoading: false,
    });

    return {
      ...publishLimit,
      hasPaidPlan: hasActivePaidPlan(freshActiveSubscription),
      isError: freshIsError,
    };
  }, [queryClient, publishedApps, publishedCount, currentAppId, isBypassEnabled]);

  return {
    ...result,
    isLoading,
    isError,
    refetch,
    confirmCanPublish,
  };
}
