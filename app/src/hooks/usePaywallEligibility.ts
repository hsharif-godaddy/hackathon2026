import React from 'react';
import { useSubscriptionByAppId } from './useSubscriptionByAppId';
import { useEntitlementsBySubscriptionId } from './useEntitlementsBySubscriptionId';
import { useMatchingProject } from './useMatchingProject';
import { useUpdateEntitlement } from './useUpdateEntitlement';
import { logger } from '@/lib/request-context';

interface PaywallEligibilityParams {
  appId: string;
}

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
  const hasEntitlements = entitlementsData?.entitlementId;

  const { data: matchingProjectData, isError: isMatchingProjectError, error: matchingProjectError } = useMatchingProject();

  const updateEntitlementMutation = useUpdateEntitlement();

  
  // Determine overall error state
  const isError = isSubscriptionError || isEntitlementsError || isMatchingProjectError || updateEntitlementMutation.isError;
  const error = subscriptionError || entitlementsError || matchingProjectError || updateEntitlementMutation.error || null;

  // Log errors when they occur
  if (isError && error && appId) {
    logger.error('paywall-eligibility.overall.error', {
      message: 'Error in paywall eligibility determination',
      error: error instanceof Error ? error.message : String(error),
      appId,
      subscriptionError: isSubscriptionError,
      entitlementsError: isEntitlementsError,
      matchingProjectError: isMatchingProjectError,
      updateEntitlementError: updateEntitlementMutation.isError
    });
  }

  // Auto-trigger entitlement update when we have a matching project and subscription
  React.useEffect(() => {
    if (matchingProjectData?.billingId && subscriptionId && !hasEntitlements && !isError) {
      if (!updateEntitlementMutation.isPending && !updateEntitlementMutation.isError) {
        logger.info('paywall-eligibility.auto-update-entitlement', {
          appId,
          subscriptionId,
          billingId: matchingProjectData.billingId
        });
        updateEntitlementMutation.mutate({
          subscriptionId,
          entitlementId: matchingProjectData.billingId
        });
      }
    }
  }, [matchingProjectData?.billingId, subscriptionId, hasEntitlements, isError, appId]);

  // Determine paywall state based on data
  let showPaywall = true; // Default to showing paywall for security

  if (!isError) {
    if (!subscriptionData) {
      // No subscription found
      showPaywall = true;
    } else if (hasEntitlements) {
      // User has entitlements
      showPaywall = false;
    } else if (matchingProjectData?.billingId && subscriptionId) {
      // Found matching project and entitlement update is in progress or completed
      showPaywall = false; // Allow access during/after update attempt
    } else {
      // No entitlements and no matching project
      showPaywall = true;
    }
  }

  return {
    showPaywall,
    isError,
    error: error as Error | null
  };
};