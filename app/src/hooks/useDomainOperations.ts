import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Domain to create for an app
 */
export interface DomainToCreate {
  fqdn: string;
  primary?: boolean;
}

/**
 * Domain to delete from an app
 */
export interface DomainToDelete {
  fqdn: string;
}

/**
 * Modify domains request payload
 */
export interface ModifyDomainsPayload {
  domainsToCreate?: DomainToCreate[];
  domainsToDelete?: DomainToDelete[];
  createCdn?: boolean;
}

/**
 * Modify domains response
 */
export interface ModifyDomainsResponse {
  statusJobId: string;
  status: string;
  message: string;
}

/**
 * Domain information with status
 */
export interface AppDomain {
  fqdn: string;
  isPrimary: boolean;
  status: string;
  cdnStatus?: string | number;
  anycastIp?: string;
  domainType?: string;
  prefix?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * App details response with domain information
 */
export interface AppDetailsResponse {
  id: string;
  name: string;
  status: string;
  subscription_id?: string;
  system_id?: string;
  domains?: AppDomain[];
  variants?: string[];
  [key: string]: any;
}

/**
 * React Query mutation hook for modifying app domains
 *
 * Triggers domain modification (create/delete) for an app and returns a job ID
 * to track the workflow progress.
 *
 * @returns Mutation object with mutate/mutateAsync functions
 *
 * @example
 * ```typescript
 * const modifyDomainsMutation = useModifyDomains();
 *
 * // Add a domain
 * await modifyDomainsMutation.mutateAsync({
 *   siteId: 'app-123',
 *   payload: {
 *     domainsToCreate: [{ fqdn: 'example.com', primary: true }],
 *     createCdn: true
 *   }
 * });
 * ```
 */
export function useModifyDomains() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      siteId,
      payload,
    }: {
      siteId: string;
      payload: ModifyDomainsPayload;
    }): Promise<ModifyDomainsResponse> => {
      logger.info('domain-operations.modify.start', {
        message: 'Starting domain modification',
        siteId,
        domainsToCreateCount: payload.domainsToCreate?.length || 0,
        domainsToDeleteCount: payload.domainsToDelete?.length || 0,
      });

      const response = await appFetch(`/api/sites/${siteId}/domains`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to modify domains: ${response.status}`;
        logger.error('domain-operations.modify.failure', {
          message: errorMessage,
          siteId,
          status: response.status,
        });
        throw new Error(errorMessage);
      }

      const data: ModifyDomainsResponse = await response.json();

      logger.info('domain-operations.modify.success', {
        message: 'Domain modification job started',
        siteId,
        statusJobId: data.statusJobId,
      });

      // Invalidate app details query to trigger refetch with new domain status
      queryClient.invalidateQueries({ queryKey: ['app-details', siteId] });

      return data;
    },
  });
}

/**
 * React Query hook for fetching app details with domain information
 *
 * Fetches app details including domain status, CDN status, and anycast IPs.
 * Used for polling domain status after modification.
 *
 * @param siteId - Site/app ID
 * @param options - Query options
 * @param options.enabled - Whether the query should be enabled (default: true)
 * @param options.refetchInterval - Polling interval in milliseconds (default: undefined)
 * @param options.includeCdn - Whether to include CDN status (default: true)
 * @returns Query result with app details
 *
 * @example
 * ```typescript
 * // Basic usage
 * const { data: appDetails } = useAppDetails('app-123');
 *
 * // Poll for domain status every 5 seconds
 * const { data: appDetails } = useAppDetails('app-123', {
 *   refetchInterval: 5000,
 *   includeCdn: true
 * });
 *
 * // Check if any domains are pending
 * const hasPendingDomains = appDetails?.fqdns?.some(d => d.status === 'pending');
 * ```
 */
export function useAppDetails(
  siteId: string | null,
  options: {
    enabled?: boolean;
    refetchInterval?: number | false;
    includeCdn?: boolean;
  } = {}
) {
  const { enabled = true, refetchInterval, includeCdn = true } = options;

  return useQuery({
    queryKey: ['app-details', siteId, includeCdn],
    queryFn: async (): Promise<AppDetailsResponse> => {
      if (!siteId) {
        throw new Error('Site ID is required');
      }

      logger.debug('domain-operations.app-details.fetch.start', {
        message: 'Fetching app details',
        siteId,
        includeCdn,
      });

      const response = await appFetch(`/api/sites/${siteId}`);

      if (!response.ok) {
        const errorMessage = `Failed to fetch app details: ${response.status}`;
        logger.error('domain-operations.app-details.fetch.failure', {
          message: errorMessage,
          siteId,
        });
        throw new Error(errorMessage);
      }

      const data: AppDetailsResponse = await response.json();

      logger.info('domain-operations.app-details.fetch.success', {
        message: 'App details fetched',
        siteId,
        hasDomains: !!data.fqdns?.length,
        domainCount: data.fqdns?.length || 0,
      });

      return data;
    },
    enabled: enabled && !!siteId,
    refetchInterval,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Helper hook to check if any domains are in pending status
 *
 * @param siteId - Site/app ID
 * @returns Object with hasPending flag and pending domains array
 */
export function usePendingDomains(siteId: string | null) {
  const { data: appDetails } = useAppDetails(siteId, {
    refetchInterval: 5000, // Poll every 5 seconds
    includeCdn: true,
  });

  const pendingDomains = appDetails?.fqdns?.filter(
    (domain) => domain.status === 'pending' || domain.cdnStatus === 'pending'
  ) || [];

  return {
    hasPending: pendingDomains.length > 0,
    pendingDomains,
    allDomains: appDetails?.fqdns || [],
  };
}

/**
 * Check if site has been published (has "publish" variant)
 */
export function hasBeenPublished(appDetails: AppDetailsResponse | null | undefined): boolean {
  return appDetails?.variants?.includes('publish') ?? false;
}
