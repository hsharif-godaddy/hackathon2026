import { useQuery } from '@tanstack/react-query';

import { HttpError } from '@/lib/errors';
import { logger } from '@/lib/request-context';
import type { CreditGrant } from '@/types/credits';

interface UseCreditGrantsOptions {
  subscriptionId: string | undefined;
  syncSpend?: boolean;
}

interface UseCreditGrantsResult {
  data: CreditGrant[] | undefined;
  isFetching: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

/**
 * React Query hook for fetching credit grants for a subscription
 *
 * Returns the credit grants (monthly plan and credit packs) for a subscription.
 * Grants are ordered by `useBefore` date to determine which should be used first.
 */
export function useCreditGrants({
  subscriptionId,
  syncSpend = true,
}: UseCreditGrantsOptions): UseCreditGrantsResult {
  // Post-turn refresh is handled by CompleteHandler, which invalidates the
  // ['credit-grants'] query directly at 5s and 30s to let mgmt-airo propagate
  // spend. Keeping the invalidation at the dispatcher avoids registering one
  // window listener per mounted caller of this hook.
  return useQuery({
    queryKey: ['credit-grants', subscriptionId, syncSpend],
    queryFn: async (): Promise<CreditGrant[]> => {
      if (!subscriptionId) {
        throw new Error('subscriptionId is required');
      }

      logger.info('credit-grants.query.start', {
        subscriptionId,
        syncSpend
      });

      const params = new URLSearchParams({
        subscriptionId,
        syncSpend: syncSpend.toString(),
      });

      const response = await fetch(`/api/credits/grants?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        const errorMessage = data.error || `Failed to fetch credit grants: ${response.status}`;
        logger.error('credit-grants.query.error', {
          subscriptionId,
          statusCode: response.status,
          error: errorMessage
        });
        throw new HttpError(errorMessage, response.status);
      }

      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        const grants: CreditGrant[] = data.data;
        logger.info('credit-grants.query.success', {
          subscriptionId,
          grantCount: grants.length
        });
        // `creditsMax` should always be set by mgmt-airo. A null value is a
        // malformed API response. Log once per fetch (not once per render of
        // every consumer) so regressions surface in Grafana without flooding.
        const invalidGrantIds = grants
          .filter((g) => g.creditsMax == null)
          .map((g) => g.id);
        if (invalidGrantIds.length > 0) {
          logger.warn('credit-grants.query.invalidGrant', {
            subscriptionId,
            grantIds: invalidGrantIds,
            invalidCount: invalidGrantIds.length,
          });
        }
        return grants;
      }

      throw new Error(data.error || 'Failed to get credit grants');
    },
    enabled: !!subscriptionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 5 * 60 * 1000,    // 5 minutes
    // Poll every 1s when grants are empty — covers the provisioning race condition
    // where subscription exists but grants haven't been created yet. Stops polling
    // once grants arrive, on error, or after 30 attempts (~30s).
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      if (query.state.data !== undefined && query.state.data.length === 0 && query.state.dataUpdateCount <= 30) {
        return 1_000;
      }
      return false;
    },
    retry: function retryOnError(failureCount, error) {
      // Don't retry on 4xx errors (client errors)
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: function calculateRetryDelay(attemptIndex) {
      return Math.min(1000 * 2 ** attemptIndex, 30000);
    },
  });
}
