/**
 * Paywall Data Prefetch Hook
 *
 * Prefetches paywall-related data early in the component lifecycle
 * so it's ready when usePaywallEligibility needs it.
 *
 * Place this hook high in your component tree (e.g., in the develop page)
 * to start fetching data immediately on mount.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { prefetchSubscription } from './useSubscription';
import { prefetchSwitchboard } from './useSwitchboard';

/**
 * Prefetch paywall-related data for faster eligibility checks
 *
 * This hook prefetches all paywall data in parallel:
 * 1. Switchboard flags (paywall + markets)
 * 2. Account subscription data
 *
 * The data is cached in React Query and will be available
 * instantly when usePaywallEligibility runs.
 */
export function usePaywallPrefetch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    prefetchSwitchboard(queryClient, 'appbuilder-airoplus-paywall');
    prefetchSwitchboard(queryClient, 'appbuilder-paywall-markets');

    prefetchSubscription(queryClient);
  }, [queryClient]);
}
