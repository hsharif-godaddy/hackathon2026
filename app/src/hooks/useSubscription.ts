/**
 * Subscription Hook
 *
 * Fetches all subscriptions for the authenticated user.
 * Returns the best/active subscription as `data` along with the full `subscriptions` array.
 */

import { type QueryClient, useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import type { AiroSubscription } from '@/lib/mgmt-airo';

const QUERY_KEY = ['subscriptions'] as const;
const STALE_TIME = 5 * 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

interface UseSubscriptionOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

interface UseSubscriptionResult {
  data: AiroSubscription | undefined;
  subscriptions: AiroSubscription[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

async function fetch() {
  const response = await appFetch('/api/subscriptions', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch subscriptions: ${response.status}`);
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
  });

  return {
    data: query.data?.active || undefined,
    subscriptions: query.data?.subscriptions || [],
    isLoading: query.isLoading,
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
