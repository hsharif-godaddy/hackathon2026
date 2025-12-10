import { useQuery } from '@tanstack/react-query';
import { getRootDomain } from '@/utils/getRootDomain';
import { logger } from '@/lib/request-context';

/**
 * Fetch feature flag value from BFF API
 * 
 * @param featureName - Name of the feature flag to fetch
 * @returns Promise with the feature flag value (boolean)
 */
async function fetchFeatureFlag(featureName: string): Promise<boolean> {
  const rootDomain = getRootDomain();
  if (!rootDomain) {
    console.warn(`Cannot fetch feature flag ${featureName}: no root domain`);
    return false;
  }

  const url = `https://bff.pcx.${rootDomain}/api/config/feature/${featureName}?app=airo-app-builder`;

  const response = await fetch(url, {
    credentials: 'include',
  });

  if (!response.ok) {
    logger.error('switchboard.fetch.failure', {
      featureName,
      status: response.status,
    });
    return false;
  }

  const data = await response.json();
  // Assuming the API returns { enabled: boolean } or similar
  return data?.setting ?? false;
}

/**
 * Hook to fetch and manage a single feature flag from BFF API using React Query
 *
 * Provides automatic caching, request deduplication, and background refetching
 *
 * @param featureName - Name of the feature flag to fetch
 * @param options - Optional configuration
 * @param options.enabled - Whether the query should run (default: true)
 * @returns React Query object with feature flag data
 *
 * @example
 * ```typescript
 * const {data: isEnabled, isLoading} = useSwitchboard('appbuilder-publish-button');
 * if (isLoading) return <Spinner />;
 * if (!isEnabled) return null;
 * return <PublishButton />;
 *
 * // Conditionally fetch based on authentication
 * const {data: isEnabled} = useSwitchboard('feature-name', { enabled: isAuthenticated });
 * ```
 */
export function useSwitchboard(featureName: string, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;

  return useQuery({
    queryKey: ['featureFlag', featureName],
    queryFn: () => fetchFeatureFlag(featureName),
    enabled: enabled && !!featureName,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
