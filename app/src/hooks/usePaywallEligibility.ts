import { isPaidPlanForGrants } from '@/lib/paywall/shared';
import { useSubscription } from './useSubscription';
import { getSwitchboardFlag } from './useSwitchboard';

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
  const paywallEnabled =
    getSwitchboardFlag('appbuilder-airoplus-paywall') === true &&
    getSwitchboardFlag('appbuilder-airoplus-markets') === true;

  const { data: subscription, isLoading: isSubscriptionLoading, isError: isSubscriptionError } = useSubscription();

  const isActive = subscription?.status === 'active';
  const hasPaidPlan = isActive && isPaidPlanForGrants(subscription?.plan);
  const hasAccess = !paywallEnabled || hasPaidPlan;

  return {
    showPaywall: isSubscriptionError || !hasAccess,
    isLoading: paywallEnabled && isSubscriptionLoading,
    isError: isSubscriptionError,
    error: null,
  };
};
