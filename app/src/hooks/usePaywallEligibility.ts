import React from 'react';
import { useEffect } from 'react';
import { shipAnalyticsLog } from '@/lib/logging';
import { useEntitlementsBySubscriptionId } from './useEntitlementsBySubscriptionId';
import { useMatchingProject } from './useMatchingProject';
import { useSubscriptionByAppId } from './useSubscriptionByAppId';
import { useUpdateEntitlement } from './useUpdateEntitlement';

interface PaywallEligibilityResult {
  showPaywall: boolean;
  isError: boolean;
  error: Error | null;
}

export const usePaywallEligibility = (appId: string | undefined): PaywallEligibilityResult => {
  // Use the individual React Query hooks
  const { data: subscriptionData, isError: isSubscriptionError, error: subscriptionError } = useSubscriptionByAppId(appId);
  const subscriptionId = subscriptionData?.subscription?.id;

  const { data: entitlementsData, isError: isEntitlementsError, error: entitlementsError } = useEntitlementsBySubscriptionId(subscriptionId);
  const hasEntitlements = !!entitlementsData?.entitlementId;
  const entitlementId = entitlementsData?.entitlementId;

  const { data: matchingProjectData, isError: isMatchingProjectError, error: matchingProjectError } = useMatchingProject();

  const {
    mutate: updateEntitlement,
    isPending: isUpdating,
    isSuccess: hasUpdated,
    isError: updateFailed
  } = useUpdateEntitlement();

  // Determine overall error state
  const isError = isSubscriptionError || isEntitlementsError || isMatchingProjectError || updateFailed;
  const error = subscriptionError || entitlementsError || matchingProjectError || null;

  // Determine if we should trigger the auto-update
  // All conditions must be met AND mutation must be idle (not pending, not completed, not failed)
  const shouldAutoUpdate =
    !!matchingProjectData?.billingId &&
    !!subscriptionId &&
    !hasEntitlements &&
    !isError &&
    !isUpdating &&
    !hasUpdated &&
    !updateFailed;

  // Log when user has Airo Plus access (let Elastic handle deduplication via unique count)
  useEffect(() => {
    if (hasEntitlements && subscriptionId) {
      shipAnalyticsLog('airoplus.access.detected', {
        appId,
        subscriptionId,
        entitlementId,
        source: 'existing-entitlement'
      });
    }
  }, [hasEntitlements, subscriptionId, appId, entitlementId]);

  // Auto-trigger entitlement update when conditions are met
  // React Query's mutation state (isPending, isSuccess, isError) prevents duplicate calls
  useEffect(() => {
    if (shouldAutoUpdate) {
      updateEntitlement({
        subscriptionId: subscriptionId!,
        entitlementId: matchingProjectData!.billingId!,
        appId
      });
    }
  }, [shouldAutoUpdate, appId, subscriptionId, matchingProjectData, updateEntitlement]);

  // Determine if paywall should be shown
  const hasValidSubscription = !!subscriptionData;
  const hasMatchingProject = !!(matchingProjectData?.billingId && subscriptionId);
  const entitlementUpdateInProgress = isUpdating || hasUpdated;

  // Show paywall unless user has access
  const hasAccess = hasValidSubscription && (hasEntitlements || entitlementUpdateInProgress || hasMatchingProject);
  const showPaywall = isError || !hasAccess;

  return {
    showPaywall,
    isError,
    error: error as Error | null
  };
};
