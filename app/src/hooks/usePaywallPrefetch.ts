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
import { prefetchSwitchboard, useSwitchboard } from './useSwitchboard';

/**
 * Prefetch paywall-related data for faster eligibility checks
 *
 * This hook prefetches all paywall data in parallel:
 * 1. Switchboard flags (paywall + markets + grants)
 * 2. Account subscription data
 *
 * When grants is disabled (legacy), also prefetches:
 * 3. Projects data (for Airo Plus matching)
 *
 * The data is cached in React Query and will be available
 * instantly when usePaywallEligibility runs.
 */
export function usePaywallPrefetch() {
  const queryClient = useQueryClient();
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants');

  useEffect(() => {
    // Prefetch feature flags used by usePaywallFeatureFlags and grants check
    prefetchSwitchboard(queryClient, 'appbuilder-airoplus-paywall');
    prefetchSwitchboard(queryClient, 'appbuilder-paywall-markets');
    prefetchSwitchboard(queryClient, 'app-builder-grants');

    // Prefetch subscription
    prefetchSubscription(queryClient);
  }, [queryClient]);

  // Only prefetch projects when grants is disabled (legacy mode)
  // When grants is enabled, projects are not used for access control
  useEffect(() => {
    if (isGrantsEnabled === false) {
      import('./useProjects').then(({ prefetchProjects }) => {
        prefetchProjects(queryClient);
      });
    }
  }, [queryClient, isGrantsEnabled]);
}
