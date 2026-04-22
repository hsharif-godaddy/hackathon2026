import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import type { AiroDomainDnsOwnershipResponse } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';

const POLL_INTERVAL_MS = 60_000;
const MAX_POLL_DURATION_MS = 40 * 60 * 1000;

export interface UseDomainDnsOwnershipOptions {
  siteId: string | null | undefined;
  fqdns: string | null | undefined;
  enabled: boolean;
}

export function domainDnsOwnershipQueryKey(
  siteId: string,
  fqdns: string
): readonly ['domain-dns-ownership', string, string] {
  return ['domain-dns-ownership', siteId, fqdns] as const;
}

/**
 * Polls GET /api/sites/:id/domain-dns-ownership every minute while enabled.
 * Polling stops when the hook is disabled or after 40 minutes from the first fetch.
 * isGdDomain does not stop polling; consumers can read the latest response from the query result.
 */
export function useDomainDnsOwnership({
  siteId,
  fqdns,
  enabled: enabledOption,
}: UseDomainDnsOwnershipOptions) {
  const enabled = !!siteId && !!fqdns && enabledOption;
  const pollingStartedAtRef = useRef<number | null>(null);

  return useQuery({
    queryKey:
      siteId && fqdns
        ? domainDnsOwnershipQueryKey(siteId, fqdns)
        : ['domain-dns-ownership', 'disabled', 'disabled'],
    queryFn: async (): Promise<AiroDomainDnsOwnershipResponse> => {
      if (!siteId || !fqdns) {
        throw new Error('domain-dns-ownership: siteId and fqdns are required');
      }

      if (pollingStartedAtRef.current === null) {
        pollingStartedAtRef.current = Date.now();
      }

      const params = new URLSearchParams({ fqdns });
      const response = await appFetch(
        `/api/sites/${siteId}/domain-dns-ownership?${params.toString()}`,
        { cache: 'no-store' }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('domain-dns-ownership-poll.fetch-failed', {
          siteId,
          fqdns,
          status: response.status,
          body: errorText.slice(0, 500),
        });
        throw new Error(`Failed to fetch domain DNS ownership: ${response.status}`);
      }

      const data = (await response.json()) as AiroDomainDnsOwnershipResponse;

      if (data.isGdDomain === true) {
        logger.info('domain-dns-ownership-poll.gd-domain', {
          siteId,
          fqdns,
        });
      }

      return data;
    },
    enabled,
    refetchInterval: () => {
      if (!enabled) {
        return false;
      }

      const pollingStartedAt = pollingStartedAtRef.current;
      if (pollingStartedAt !== null && Date.now() - pollingStartedAt > MAX_POLL_DURATION_MS) {
        logger.warn('domain-dns-ownership-poll.timeout', {
          siteId,
          fqdns,
          elapsedMs: Date.now() - pollingStartedAt,
        });
        return false;
      }

      return POLL_INTERVAL_MS;
    },
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    retryDelay: 1000,
  });
}
