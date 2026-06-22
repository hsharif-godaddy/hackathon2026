import { useQuery } from '@tanstack/react-query';

import { type DomainFilter } from '@/lib/domains';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Domain information from GoDaddy API
 */
export interface Domain {
  domain: string; // Primary domain name from API
  // Extended fields (may not always be present)
  name?: string;
  id?: number;
  createDate?: string;
  expirationDate?: string;
  isLocked?: boolean;
  isPrivate?: boolean;
  hasAutoRenew?: boolean;
  hasInternalNameservers?: boolean;
  status?: number;
  nameservers?: string[];
  internationalDisplayName?: string;
}

/**
 * Response from domains API endpoint
 */
interface DomainsResponse {
  domains: Domain[];
  firstDomainName?: string;
  lastDomainName?: string;
  totalInSearch: number;
  tlds?: string[];
}

/**
 * Options for useDomainsQuery hook
 */
export interface UseDomainsQueryOptions {
  enabled?: boolean;
  filter?: DomainFilter;
}

/**
 * React Query hook for fetching user domains from GoDaddy
 *
 * Fetches the authenticated user's domains from the GoDaddy API.
 * Uses TanStack Query for automatic caching and background refetching.
 *
 * @param options - Configuration options
 * @param options.enabled - Whether the query should be enabled (default: true)
 * @returns Query result with domains data
 *
 * @example
 * ```typescript
 * // Basic usage
 * const { data: domains, isLoading, error } = useDomainsQuery();
 *
 * // Conditional fetching (wait for authentication)
 * const { data: domains } = useDomainsQuery({
 *   enabled: isAuthenticated && !authLoading
 * });
 * ```
 */
export function useDomainsQuery({
  enabled = true,
  filter,
}: UseDomainsQueryOptions = {}) {
  return useQuery({
    queryKey: ['domains', filter ?? null],
    queryFn: async (): Promise<Domain[]> => {
      logger.debug('domains-query.fetch.start', {
        message: 'Fetching domains via React Query',
      });

      const url = filter
        ? `/api/domains?filter=${encodeURIComponent(JSON.stringify(filter))}`
        : '/api/domains';
      const response = await appFetch(url);

      if (!response.ok) {
        const errorMessage = `Failed to fetch domains: ${response.status} ${response.statusText}`;
        logger.error('domains-query.fetch.failure', {
          message: errorMessage,
        });
        throw new Error(errorMessage);
      }

      const data: DomainsResponse = await response.json();
      const domains = data.domains || [];

      logger.info('domains-query.fetch.success', {
        message: 'Domains fetched',
        count: domains.length,
      });

      return domains;
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes - domains don't change frequently
    retry: 2, // Retry failed requests twice
  });
}

