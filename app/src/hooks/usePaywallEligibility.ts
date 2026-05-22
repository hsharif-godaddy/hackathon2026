import { isPaidPlanForGrants } from '@/lib/paywall/shared';
import { useSubscription } from './useSubscription';

interface PaywallEligibilityResult {
  showPaywall: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Hook to check account-level paywall eligibility.
 *
 * Paid plan (Starter, Professional, Ultimate) = access granted.
 * Non-paid plans (Free, None, AiroPlus) = paywall.
 */
export const usePaywallEligibility = (): PaywallEligibilityResult => {
  const { data: subscription, isLoading: isSubscriptionLoading, isError: isSubscriptionError } = useSubscription();

  const isActive = subscription?.status === 'active';
  const hasPaidPlan = isActive && isPaidPlanForGrants(subscription?.plan);

  return {
    showPaywall: isSubscriptionError || !hasPaidPlan,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
    error: null,
  };
};
