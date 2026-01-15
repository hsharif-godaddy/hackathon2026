import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { shipAnalyticsLog } from '@/lib/logging';
import { ClientPaywallProvider } from '@/lib/paywall/client-provider';
import { checkPaywallEligibility } from '@/lib/paywall/core';
import { useUpdateEntitlement } from './useUpdateEntitlement';

interface PaywallEligibilityResult {
  showPaywall: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export const usePaywallEligibility = (appId: string | undefined): PaywallEligibilityResult => {
  // Use consolidated paywall check
  const {
    data: paywallResult,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['paywall-eligibility', appId],
    queryFn: async () => {
      if (!appId) {
        return {
          hasAccess: false,
          details: {
            hasSubscription: false,
            hasEntitlements: false,
            hasMatchingProject: false,
          },
        };
      }

      const provider = new ClientPaywallProvider();
      const result = await checkPaywallEligibility(appId, provider);
      return result;
    },
    enabled: !!appId,
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnWindowFocus: true,
  });

  const {
    mutate: updateEntitlement,
    isPending: isUpdating,
    isSuccess: hasUpdated,
    isError: updateFailed,
  } = useUpdateEntitlement();

  // Extract details from result
  const hasEntitlements = paywallResult?.details.hasEntitlements ?? false;
  const hasMatchingProject = paywallResult?.details.hasMatchingProject ?? false;
  const subscriptionId = paywallResult?.details.subscriptionId;
  const entitlementId = paywallResult?.details.entitlementId;
  const billingId = paywallResult?.details.billingId;

  // Determine overall error state
  const hasError = isError || updateFailed;
  const finalError = error || null;

  // Determine if we should trigger the auto-update
  // User has subscription + matching project but no entitlements yet
  const shouldAutoUpdate =
    !!billingId &&
    !!subscriptionId &&
    !hasEntitlements &&
    hasMatchingProject &&
    !hasError &&
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
        source: 'existing-entitlement',
      });
    }
  }, [hasEntitlements, subscriptionId, appId, entitlementId]);

  // Auto-trigger entitlement update when conditions are met
  // React Query's mutation state (isPending, isSuccess, isError) prevents duplicate calls
  useEffect(() => {
    if (shouldAutoUpdate) {
      updateEntitlement({
        subscriptionId: subscriptionId!,
        entitlementId: billingId!,
        appId,
      });
    }
  }, [shouldAutoUpdate, appId, subscriptionId, billingId, updateEntitlement]);

  // Determine if paywall should be shown
  // Trust the consolidated check result, but allow in-progress updates
  const entitlementUpdateInProgress = isUpdating || hasUpdated;
  const hasAccess = paywallResult?.hasAccess || entitlementUpdateInProgress;

  const showPaywall = hasError || !hasAccess;

  return {
    showPaywall,
    isLoading,
    isError: hasError,
    error: finalError as Error | null,
  };
};
