/**
 * Subscription Hook
 *
 * Fetches account-level subscription data.
 */

import { type QueryClient, useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import type { SubscriptionPlan } from '@/types/credits';

const QUERY_KEY = ['subscription'] as const;
const STALE_TIME = 30000;

export interface Subscription {
  id: string;
  plan?: SubscriptionPlan;
  productId?: string;
  isTrial?: boolean;
  status?: string;
}

async function fetch(): Promise<Subscription | null> {
  const response = await appFetch('/api/subscription', { credentials: 'include' });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.data?.subscription ?? null;
}

export function useSubscription() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetch,
    staleTime: STALE_TIME,
  });
}

export function prefetchSubscription(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: QUERY_KEY,
    queryFn: fetch,
    staleTime: STALE_TIME,
  });
}
