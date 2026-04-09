import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';
import { BUDGET_STATUS_QUERY_KEY, type CreditStatusResponse } from '@/types/budget';

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

interface UseBudgetServiceOptions {
  subscriptionId: string | undefined;
  enabled: boolean;
}

interface UseBudgetServiceResult {
  data: CreditStatusResponse | undefined;
  isFetching: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

/**
 * React Query hook for fetching credit status from Budget Service via BFF
 *
 * Parallel to useCreditGrants (legacy mgmt-airo path). When budget-service
 * flag is ON, callers use this instead. The `enabled` param is controlled
 * by the caller (typically from useSwitchboard('app-builder-budget-service')).
 */
export function useBudgetService({
  subscriptionId,
  enabled,
}: UseBudgetServiceOptions): UseBudgetServiceResult {
  const queryEnabled = enabled && !!subscriptionId;

  const { data, isFetching, isLoading: isQueryLoading, isError, error, refetch } = useQuery({
    queryKey: [BUDGET_STATUS_QUERY_KEY, subscriptionId],
    queryFn: async (): Promise<CreditStatusResponse> => {
      const subId = subscriptionId!;
      logger.info('budget-status.query.start', { subscriptionId: subId });

      const params = new URLSearchParams({ subscriptionId: subId });
      const response = await fetch(`/api/credits/status?${params}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        let errorMessage = `Failed to fetch credit status: ${response.status}`;
        try {
          const errorJson = await response.json();
          if (errorJson.error) errorMessage = errorJson.error;
        } catch {
          // Non-JSON error body (e.g., HTML gateway page)
        }
        logger.error('budget-status.query.error', {
          subscriptionId,
          statusCode: response.status,
          error: errorMessage,
        });
        throw new HttpError(errorMessage, response.status);
      }

      const json = await response.json();

      if (json.success && json.data) {
        logger.info('budget-status.query.success', {
          subscriptionId,
          creditsTotal: json.data.creditsTotalNumeric,
          creditsUsed: json.data.creditsUsedNumeric,
        });
        return json.data;
      }

      throw new Error(json.error || 'Failed to get credit status');
    },
    enabled: queryEnabled,
    staleTime: 60_000,
    gcTime: 300_000,
    retry: function retryOnError(failureCount, error) {
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: function calculateRetryDelay(attemptIndex) {
      return Math.min(1000 * 2 ** attemptIndex, 30000);
    },
  });

  const isLoading = queryEnabled && isQueryLoading;

  return { data, isFetching, isLoading, isError, error: error ?? null, refetch };
}
