import { useEffect } from 'react';

import { shipAnalyticsLog } from '@/lib/logging';
import { isMatchingProject, isPaidPlanForGrants } from '@/lib/paywall/shared';
import { useEntitlements } from './useEntitlements';
import { usePaywallFeatureFlags } from './usePaywallFeatureFlags';
import { useProjects } from './useProjects';
import { useSubscription } from './useSubscription';
import { useSwitchboard } from './useSwitchboard';
import { useUpdateEntitlement } from './useUpdateEntitlement';

interface PaywallEligibilityResult {
  showPaywall: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Hook to check account-level paywall eligibility
 *
 * Uses individual query hooks for each data source.
 * React Query handles caching and deduplication automatically.
 *
 * When app-builder-grants is enabled:
 * - Paid plan (Starter only) = access granted
 * - Non-paid plans (Free, None, AiroPlus) = paywall (no legacy fallbacks)
 *
 * When app-builder-grants is disabled (legacy):
 * - Also checks entitlements and matching Airo Plus projects
 *
 * @param appId - Optional app ID for legacy compatibility and logging
 * @returns PaywallEligibilityResult
 */
export const usePaywallEligibility = (appId?: string): PaywallEligibilityResult => {
  // Check if grants feature is enabled - controls whether legacy fallbacks are used
  const { data: isGrantsEnabled, isLoading: isGrantsFlagLoading } = useSwitchboard('app-builder-grants');

  // Step 1: Fetch feature flags
  const { data: featureFlags, isLoading: isFlagsLoading, isError: isFlagsError } = usePaywallFeatureFlags();
  // Explicitly check for true to ensure paywallEnabled is always boolean, never undefined
  // This prevents React Query errors when used in enabled conditions
  const paywallEnabled = featureFlags?.paywall === true && featureFlags?.markets === true;

  // Step 2: Fetch subscription data (only if paywall enabled)
  const { data: subscription, isLoading: isSubscriptionLoading, isError: isSubscriptionError } = useSubscription();

  // Check if user has active paid plan - if so, grant access immediately
  // Subscription must be active AND have a paid plan type
  // When grants is enabled, only Starter is a paid plan (AiroPlus is not)
  const isActive = subscription?.status === 'active';
  const hasPaidPlan = isActive && isPaidPlanForGrants(subscription?.plan, !!isGrantsEnabled);

  // Only need additional checks for free/none plans when grants is NOT enabled
  // When grants is enabled, only subscription plan matters - no legacy fallbacks
  // Wait for grants flag to load before enabling legacy checks (isGrantsEnabled === false, not undefined)
  const needsAdditionalChecks = !!(paywallEnabled && subscription && !hasPaidPlan && isGrantsEnabled === false);

  // Step 3: Fetch entitlements (only if needed - disabled when grants is enabled)
  const { data: entitlementId, isLoading: isEntitlementsLoading } = useEntitlements({
    subscriptionId: subscription?.id,
    enabled: needsAdditionalChecks,
  });

  // Step 4: Fetch projects for Airo Plus matching (only if needed - disabled when grants is enabled)
  const { data: projects, isLoading: isProjectsLoading } = useProjects({
    enabled: needsAdditionalChecks,
  });

  // Find matching Airo Plus project
  const matchingProject = projects?.find((edge) => isMatchingProject(edge.node));
  const billingId = matchingProject?.node?.billing?.id;

  // Compute loading state - only wait for what we need
  const isLoading = isGrantsFlagLoading || isFlagsLoading ||
    (paywallEnabled && isSubscriptionLoading) ||
    (needsAdditionalChecks && (isEntitlementsLoading || isProjectsLoading));

  // Compute access
  const hasEntitlements = !!entitlementId;
  const hasMatchingProject = !!billingId;
  const hasAccess = !paywallEnabled || hasPaidPlan || hasEntitlements || hasMatchingProject;

  // Auto-update entitlement logic
  const {
    mutate: updateEntitlement,
    isPending: isUpdating,
    isSuccess: hasUpdated,
    isError: updateFailed,
  } = useUpdateEntitlement();

  const shouldAutoUpdate =
    !!billingId &&
    !!subscription?.id &&
    !hasEntitlements &&
    hasMatchingProject &&
    !isUpdating &&
    !hasUpdated &&
    !updateFailed;

  // Log when user has Airo Plus access
  useEffect(() => {
    if (hasEntitlements && subscription?.id) {
      shipAnalyticsLog('airoplus.access.detected', {
        appId,
        subscriptionId: subscription.id,
        entitlementId,
        source: 'existing-entitlement',
      });
    }
  }, [hasEntitlements, subscription?.id, appId, entitlementId]);

  // Auto-trigger entitlement update when conditions are met
  useEffect(() => {
    if (shouldAutoUpdate && subscription?.id && billingId) {
      updateEntitlement({
        subscriptionId: subscription.id,
        entitlementId: billingId,
        appId,
      });
    }
  }, [shouldAutoUpdate, appId, subscription?.id, billingId, updateEntitlement]);

  // Determine if paywall should be shown
  const entitlementUpdateInProgress = isUpdating || hasUpdated;
  const finalHasAccess = hasAccess || entitlementUpdateInProgress;
  const hasError = isFlagsError || isSubscriptionError || updateFailed;
  const showPaywall = hasError || !finalHasAccess;

  return {
    showPaywall,
    isLoading,
    isError: hasError,
    error: null,
  };
};
