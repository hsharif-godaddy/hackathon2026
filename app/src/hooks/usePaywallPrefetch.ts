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

import { prefetchProjects } from './useProjects';
import { prefetchSubscription } from './useSubscription';
import { prefetchSwitchboard } from './useSwitchboard';

/**
 * Prefetch paywall-related data for faster eligibility checks
 *
 * This hook prefetches all paywall data in parallel:
 * 1. Switchboard flags (paywall + markets)
 * 2. Account subscription data
 * 3. Projects data (for Airo Plus matching)
 *
 * The data is cached in React Query and will be available
 * instantly when usePaywallEligibility runs.
 */
export function usePaywallPrefetch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Prefetch feature flags used by usePaywallFeatureFlags
    prefetchSwitchboard(queryClient, 'appbuilder-airoplus-paywall');
    prefetchSwitchboard(queryClient, 'appbuilder-paywall-markets');

    // Prefetch subscription and projects
    prefetchSubscription(queryClient);
    prefetchProjects(queryClient);
  }, [queryClient]);
}
