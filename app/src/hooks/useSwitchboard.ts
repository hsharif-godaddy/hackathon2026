import { type QueryClient, useQuery } from '@tanstack/react-query';

import { isFeatureEnabled } from '@/lib/features';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { getRootDomain } from '@/utils/getRootDomain';

export class SwitchboardAuthError extends Error {
  constructor(featureName: string) {
    super(`Authentication required to fetch feature flag: ${featureName}`);
    this.name = 'SwitchboardAuthError';
  }
}

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
  'appbuilder-settings-visualscan': true,
  'appbuilder-settings-team': true,
  'appbuilder-settings-marketing': true,
  'appbuilder-share-links': true,
  'app-builder-bypass-publish-limit': true, // allows unlimited app publishing
  'appbuilder-social-video-generation': true,
  'app-builder-app-on-demand-reload': true,
  'appbuilder-domain-purchase': true,
  'appbuilder-domain-transfer': true,
  'appbuilder-transfer-ownership': true,
  'appbuilder-analytics': true,
  'appbuilder-settings-analytics': true,
  'appbuilder-suspended-compliance-banner': true,
  'appbuilder-suspended-nonpayment-banner': true,
  'appbuilder-github-integration': true,
  'appbuilder-unpublish': true,
  'app-builder-budget-service': false, // opt-in: requires running Budget Service
  'appbuilder-template-selector': true,
  'appbuilder-model-selector': true,
  'appbuilder-agent-profile-selector': true,
  'airo-builder-support-chat-ui': true, // default: show support messages locally
  'airo-builder-chat-plans': true, // opt-in: enables combined NBA + plan panel in chat input
  'airo-builder-feedback-multistep': true, // multi-step feedback dialog (support / bug report / feedback)
  'appbuilder-post-publish-feature-selection': true,
  'appbuilder-brandbook': true, // opt-in: brand book view in develop page header
};

interface FetchOptions {
  throwOnAuth?: boolean;
}

/**
 * Fetch feature flag value from BFF API
 *
 * This is the non-React version for use in services and providers.
 * For React components, use the `useSwitchboard` hook instead.
 *
 * By default fail-soft: returns false on any error (including 401).
 * Pass `throwOnAuth: true` to throw SwitchboardAuthError on 401 -
 * used by `useSwitchboard` so React Query can surface it to the UI.
 *
 * @param featureName - Name of the feature flag to fetch
 * @param options.throwOnAuth - Throw SwitchboardAuthError on 401 instead of returning false
 * @returns Promise with the feature flag value (boolean)
 */
export async function fetchFeatureFlag(featureName: string, options?: FetchOptions): Promise<boolean> {
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

  // appFetch sets needsReauth on 401 → AuthBoundary shows login modal
  const response = await appFetch(url);

  // Throw SwitchboardAuthError separately for React Query error propagation.
  // This is intentionally separate from appFetch's needsReauth (UI state) -
  // the error allows callers like useSettingsNavItems to surface auth-gated state.
  if (response.status === 401 && options?.throwOnAuth) {
    logger.warn('switchboard.fetch.auth_required', { featureName });
    throw new SwitchboardAuthError(featureName);
  }

  if (!response.ok) {
    logger.error('switchboard.fetch.failure', {
      featureName,
      status: response.status,
    });
    return false;
  }

  const data = await response.json();
  return data?.setting ?? false;
}

/**
 * Hook to fetch and manage a single feature flag from BFF API using React Query
 *
 * Provides automatic caching, request deduplication, and background refetching.
 * Throws SwitchboardAuthError on 401 so the UI can surface auth-gated state
 * (e.g. needsAuth on settings nav items).
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
    queryFn: () => fetchFeatureFlag(featureName, { throwOnAuth: true }),
    enabled: enabled && !!featureName,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof SwitchboardAuthError) return false;
      return failureCount < 1;
    },
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
