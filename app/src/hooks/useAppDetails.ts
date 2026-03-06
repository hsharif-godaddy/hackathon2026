import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Domain information in app response
 */
export interface AppDomain {
  fqdn: string;
  isPrimary: boolean;
  status: string;
  cdnStatus?: string | number;
  anycastIp?: string;
  certificateValidationCname?: string;
  domainType?: string;
  prefix?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * App details response from API
 */
export interface AppDetailsResponse {
  id: string;
  name: string;
  status: string;
  domains?: AppDomain[];
  [key: string]: any;
}

/**
 * React Query hook to fetch app details
 *
 * Retrieves complete application information including domains, status,
 * and configuration. Supports optional polling via refetchInterval.
 *
 * @param siteId - Application/site ID
 * @param options - Query configuration options
 * @param options.enabled - Whether query should run (default: true)
 * @param options.refetchInterval - Polling interval in ms, false to disable, or function that returns interval based on data
 * @param options.includeCdn - Whether to include CDN information (default: false)
 * @returns Query result with app details data
 *
 * @example
 * ```typescript
 * // Static polling
 * const { data: appDetails } = useAppDetails('app-123', {
 *   refetchInterval: 5000, // Poll every 5 seconds
 * });
 *
 * // Dynamic polling based on data
 * const { data: appDetails } = useAppDetails('app-123', {
 *   refetchInterval: (data) => {
 *     const hasPending = data?.domains?.some(d => d.status === 'pending');
 *     return hasPending ? 5000 : false; // Only poll when needed
 *   }
 * });
 * ```
 */
export function useAppDetails(
  siteId: string | null,
  options: {
    enabled?: boolean;
    refetchInterval?: number | false | ((data: AppDetailsResponse | undefined) => number | false);
    includeCdn?: boolean;
  } = {}
) {
  const { enabled = true, refetchInterval, includeCdn = false } = options;

  return useQuery({
    queryKey: ['app-details', siteId, includeCdn],
    queryFn: async (): Promise<AppDetailsResponse> => {
      if (!siteId) {
        throw new Error('Site ID is required');
      }

      logger.debug('app-details.fetch.start', {
        message: 'Fetching app details',
        siteId,
        includeCdn,
      });

      const params = includeCdn ? '?includeCdn=true' : '';
      const response = await appFetch(`/api/sites/${siteId}${params}`);

      if (!response.ok) {
        const errorMessage = `Failed to fetch app details: ${response.status}`;
        logger.error('app-details.fetch.failure', {
          message: errorMessage,
          siteId,
          status: response.status,
        });
        throw new Error(errorMessage);
      }

      const data: AppDetailsResponse = await response.json();

      logger.info('app-details.fetch.success', {
        message: 'App details fetched successfully',
        siteId,
        hasDomains: !!data.domains?.length,
        domainCount: data.domains?.length || 0,
      });

      return data;
    },
    enabled: enabled && !!siteId,
    refetchInterval: typeof refetchInterval === 'function'
      ? (query) => refetchInterval(query.state.data)
      : refetchInterval,
    staleTime: 30 * 1000, // 30 seconds
  });
}

