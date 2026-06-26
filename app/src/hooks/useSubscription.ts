/**
 * Subscription Hook
 *
 * Fetches all subscriptions for the authenticated user.
 * Returns the best/active subscription as `data` along with the full `subscriptions` array.
 */

import { type Query, type QueryClient, useQuery } from '@tanstack/react-query';

import { HttpError } from '@/lib/errors';
import { appFetch } from '@/lib/gasket-config';
import type { AiroSubscription } from '@/lib/mgmt-airo';

export const SUBSCRIPTIONS_QUERY_KEY = ['subscriptions'] as const;
const QUERY_KEY = SUBSCRIPTIONS_QUERY_KEY;
const STALE_TIME = 5 * 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

/** Shape cached under the `['subscriptions']` query key. */
export interface SubscriptionQueryData {
  subscriptions: AiroSubscription[];
  active: AiroSubscription | null;
}

interface UseSubscriptionOptions {
  enabled?: boolean;
  /** Number, false, or a predicate over the cached query — mirrors TanStack's refetchInterval. */
  refetchInterval?:
    | number
    | false
    | ((query: Query<SubscriptionQueryData>) => number | false | undefined);
}

interface UseSubscriptionResult {
  data: AiroSubscription | undefined;
  subscriptions: AiroSubscription[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

async function fetch() {
  const response = await appFetch('/api/subscriptions', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new HttpError(`Failed to fetch subscriptions: ${response.status}`, response.status);
  }

  const json = await response.json();

  if (!json.success || !json.data) {
    throw new Error(json.error || 'Failed to get subscription data');
  }

  return {
    subscriptions: json.data.subscriptions || [],
    active: json.data.active || null
  };
}

export function useSubscription(options: UseSubscriptionOptions = {}): UseSubscriptionResult {
  const { enabled = true, refetchInterval = false } = options;

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetch,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled,
    refetchInterval,
    retry(failureCount, error) {
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay(attemptIndex) {
      return Math.min(1000 * 2 ** attemptIndex, 30000);
    },
  });

  return {
    data: query.data?.active || undefined,
    subscriptions: query.data?.subscriptions || [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function prefetchSubscription(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: QUERY_KEY,
    queryFn: fetch,
    staleTime: STALE_TIME,
  });
}
