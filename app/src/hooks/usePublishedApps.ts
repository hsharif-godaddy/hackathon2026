/**
 * Published Apps Hook
 *
 * Filters the sites list for apps that have been published
 * (have an active 'publish' variant in variantsWithLifecycle).
 */

import { useMemo } from 'react';

import { filterPublishedApps } from '@/lib/publish-limit';
import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';
import { useSites } from '@/stores/useSitesStore';

interface UsePublishedAppsResult {
  publishedApps: SiteInfo[];
  count: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Hook to get published apps for the current user
 *
 * Filters useSites for apps with an active 'publish' variant.
 *
 * @param options - Optional configuration
 * @param options.enabled - Whether to enable fetching (default: true)
 * @returns Published apps data and query state
 */
export function usePublishedApps(options: { enabled?: boolean } = {}): UsePublishedAppsResult {
  const { enabled = true } = options;

  const { sites, isLoading, error, refreshSites } = useSites({ enabled });

  const publishedApps = useMemo(() => {
    if (!enabled) {return [];}
    return filterPublishedApps(sites);
  }, [sites, enabled]);

  return {
    publishedApps,
    count: publishedApps.length,
    isLoading,
    isError: !!error,
    refetch: refreshSites,
  };
}
