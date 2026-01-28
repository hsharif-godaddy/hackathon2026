/**
 * Paywall Feature Flags Hook
 *
 * Combines the two switchboard flags needed for paywall eligibility.
 */

import { useSwitchboard } from './useSwitchboard';

interface PaywallFeatureFlags {
  paywall: boolean;
  markets: boolean;
}

interface UsePaywallFeatureFlagsResult {
  data: PaywallFeatureFlags | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Hook to fetch paywall-related feature flags
 *
 * Combines:
 * - appbuilder-airoplus-paywall: Main paywall toggle
 * - appbuilder-airoplus-markets: Market-specific paywall toggle
 *
 * Both must be true for paywall to be enabled.
 */
export function usePaywallFeatureFlags(): UsePaywallFeatureFlagsResult {
  const paywallFlag = useSwitchboard('appbuilder-airoplus-paywall');
  const marketsFlag = useSwitchboard('appbuilder-airoplus-markets');

  const isLoading = paywallFlag.isLoading || marketsFlag.isLoading;
  const isError = paywallFlag.isError || marketsFlag.isError;

  const data = !isLoading ? {
    paywall: paywallFlag.data ?? false,
    markets: marketsFlag.data ?? false,
  } : undefined;

  return { data, isLoading, isError };
}
