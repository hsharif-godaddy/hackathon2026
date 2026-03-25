import { type QueryClient, useQuery } from '@tanstack/react-query';

import { isFeatureEnabled } from '@/lib/features';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { getRootDomain } from '@/utils/getRootDomain';

/**
 * Local development feature flags
 * Override switchboard for local development when NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true
 *
 * Only includes features required for local dev publish functionality.
 */
const LOCAL_FEATURE_OVERRIDES: Record<string, boolean> = {
  'appbuilder-publish-button': true,
  'appbuilder-manage-plan': true,
  'appbuilder-settings-secrets': true,
  'appbuilder-settings-team': true,
  'appbuilder-settings-marketing': true,
  'appbuilder-share-links': true,
  'app-builder-grants': true,
  'app-builder-bypass-publish-limit': true, // allows unlimited app publishing
  'appbuilder-social-video-generation': true,
  'app-builder-app-on-demand-reload': true,
  'appbuilder-domain-purchase': true,
  'appbuilder-transfer-ownership': true,
  'appbuilder-higher-plans': true,
  'appbuilder-edit-mode': true,
};

/**
 * Fetch feature flag value from BFF API
 *
 * This is the non-React version for use in services and providers.
 * For React components, use the `useSwitchboard` hook instead.
 *
 * @param featureName - Name of the feature flag to fetch
 * @returns Promise with the feature flag value (boolean)
 */
export async function fetchFeatureFlag(featureName: string): Promise<boolean> {
  if (isFeatureEnabled.localFeatures() && featureName in LOCAL_FEATURE_OVERRIDES) {
    logger.info('switchboard.local_override', {
      featureName,
      value: LOCAL_FEATURE_OVERRIDES[featureName],
    });
    return LOCAL_FEATURE_OVERRIDES[featureName];
  }

  const rootDomain = getRootDomain();
  if (!rootDomain) {
    logger.warn('switchboard.no_root_domain', {
      featureName,
      message: 'Cannot fetch feature flag: no root domain'
    });
    return false;
  }

  const url = `https://bff.pcx.${rootDomain}/api/config/feature/${featureName}?app=airo-app-builder`;

  const response = await appFetch(url, {}, { setAuthState: false });

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

/**
 * Prefetch a feature flag into the query cache
 *
 * @param queryClient - React Query client
 * @param featureName - Name of the feature flag to prefetch
 */
export function prefetchSwitchboard(queryClient: QueryClient, featureName: string) {
  return queryClient.prefetchQuery({
    queryKey: ['featureFlag', featureName],
    queryFn: () => fetchFeatureFlag(featureName),
    staleTime: 5 * 60 * 1000,
  });
}
