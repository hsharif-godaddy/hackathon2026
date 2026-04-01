import { isPaidPlanForGrants } from '@/lib/paywall/shared';
import { usePaywallFeatureFlags } from './usePaywallFeatureFlags';
import { useSubscription } from './useSubscription';

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
 * Paid plan (Starter, Professional, Ultimate) = access granted
 * Non-paid plans (Free, None, AiroPlus) = paywall
 *
 * @returns PaywallEligibilityResult
 */
export const usePaywallEligibility = (): PaywallEligibilityResult => {
  // Step 1: Fetch feature flags
  const { data: featureFlags, isLoading: isFlagsLoading, isError: isFlagsError } = usePaywallFeatureFlags();
  const paywallEnabled = featureFlags?.paywall === true && featureFlags?.markets === true;

  // Step 2: Fetch subscription data
  const { data: subscription, isLoading: isSubscriptionLoading, isError: isSubscriptionError } = useSubscription();

  const isActive = subscription?.status === 'active';
  const hasPaidPlan = isActive && isPaidPlanForGrants(subscription?.plan);

  const isLoading = isFlagsLoading || (paywallEnabled && isSubscriptionLoading);

  const hasAccess = !paywallEnabled || hasPaidPlan;

  const hasError = isFlagsError || isSubscriptionError;
  const showPaywall = hasError || !hasAccess;

  return {
    showPaywall,
    isLoading,
    isError: hasError,
    error: null,
  };
};
