import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';
import type { CreditGrant } from '@/types/credits';

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

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

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.error || `Failed to fetch credit grants: ${response.status}`;
        logger.error('credit-grants.query.error', {
          subscriptionId,
          statusCode: response.status,
          error: errorMessage
        });
        throw new HttpError(errorMessage, response.status);
      }

      if (data.success && Array.isArray(data.data)) {
        logger.info('credit-grants.query.success', {
          subscriptionId,
          grantCount: data.data.length
        });
        return data.data;
      }

      throw new Error(data.error || 'Failed to get credit grants');
    },
    enabled: !!subscriptionId,
    staleTime: 1 * 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000,    // 5 minutes
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
