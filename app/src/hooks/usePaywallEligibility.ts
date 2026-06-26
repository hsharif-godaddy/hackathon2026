import { hasActivePaidPlan } from '@/lib/paywall/shared';
import { useSiteStore } from '@/stores/useSiteStore';
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
 *
 * Owner-pays bypass: pass the current `appId` and, if it's shared with the
 * caller (an invited collaborator), the paywall is never shown — the invitee is
 * not the billing principal and their permissions come from FGA. This is the
 * single source of truth, so every consumer (publish popover, chat publish tool,
 * header Upgrade button, download) inherits the bypass.
 */
export const usePaywallEligibility = (appId?: string): PaywallEligibilityResult => {
  const { data: subscription, isLoading: isSubscriptionLoading, isError: isSubscriptionError } = useSubscription();
  const site = useSiteStore((state) => (appId ? state.getSite(appId) : null));
  const isSiteLoading = useSiteStore((state) => (appId ? (state.loading?.[appId] ?? false) : false));

  // Until the site is loaded we don't know whether it's shared (owner-pays).
  // Treat that window as loading and DON'T show the paywall: otherwise an invited
  // collaborator briefly renders the free-owner UI (Upgrade button + paywall-
  // gated Publish) before `sharedWithMe` resolves, then it flips. Deferring here
  // fixes every consumer at once (they already gate on isLoading).
  if (appId && (isSiteLoading || !site)) {
    return { showPaywall: false, isLoading: true, isError: false, error: null };
  }

  if (site?.sharedWithMe) {
    return { showPaywall: false, isLoading: false, isError: false, error: null };
  }

  const hasPaidPlan = hasActivePaidPlan(subscription);

  return {
    // TanStack keeps prior data on a background refetch error, so showPaywall
    // derives only from hasActivePaidPlan — a refetch error alone does not paywall.
    showPaywall: !hasPaidPlan,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
    error: null,
  };
};
