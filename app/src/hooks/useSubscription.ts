/**
 * Subscription Hook
 *
 * Fetches all subscriptions for the authenticated user.
 * Returns the best/active subscription as `data` along with the full `subscriptions` array.
 */

import { type Query, type QueryClient, useQuery } from '@tanstack/react-query';

import { SWITCHBOARD_APPBUILDER_SUBSCRIPTIONS_HANDLE401 } from '@/config/switchboard-flags';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { HttpError } from '@/lib/errors';
import { appFetch, AuthDismissedError } from '@/lib/gasket-config';
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

async function fetch(handle401: boolean): Promise<SubscriptionQueryData> {
  // handle401 funnels a 401 through resolveAuth (single-flight) so a stale-vat
  // or logged-out session opens one SSO modal and the request retries once on
  // re-auth — instead of every consumer (and the 5s entitlement/conversion
  // pollers) silently re-firing a 401 with no recovery. Level 2: /api/subscriptions
  // is IAT-gated, not an HBI step-up. Gated by the appbuilder-subscriptions-handle401
  // Switchboard flag; when off, a 401 surfaces as an HttpError (pre-fix behavior)
  // and no SSO modal opens — the retry/refetchInterval auth-error guards below
  // then go inert because AuthDismissedError is never thrown.
  const response = await appFetch(
    '/api/subscriptions',
    { credentials: 'include' },
    { handle401 },
  );

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
  const handle401Enabled: boolean =
    useSwitchboard(SWITCHBOARD_APPBUILDER_SUBSCRIPTIONS_HANDLE401) ?? false;

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: function queryFn(): Promise<SubscriptionQueryData> {
      return fetch(handle401Enabled);
    },
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled,
    refetchInterval(query: Query<SubscriptionQueryData>): number | false | undefined {
      // retry and refetchInterval are independent in TanStack v5: the retry
      // guard below stops React Query's internal retries, but the poll timer
      // keeps firing on the interval regardless of error state. Once the user
      // dismisses the handle401 SSO prompt, stop polling — otherwise the next
      // interval tick re-opens the modal every few seconds
      // (useSubscriptionWithPolling at 5s, useConversionEvent's gate) up to
      // the 2-min cap. Both pollers run through this shared query.
      if (query.state.error instanceof AuthDismissedError) {
        return false;
      }
      return typeof refetchInterval === 'function' ? refetchInterval(query) : refetchInterval;
    },
    retry(failureCount: number, error: Error): boolean {
      // A dismissed SSO prompt from handle401 must not be retried — retrying
      // would re-open the modal the user just closed.
      if (error instanceof AuthDismissedError) {
        return false;
      }
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay(attemptIndex: number): number {
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

export function prefetchSubscription(queryClient: QueryClient): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: QUERY_KEY,
    // handle401 is always false here: prefetchSubscription is a plain function
    // (called from a useEffect), not a hook, so it cannot call useSwitchboard.
    // The client-side useSubscription hook drives the flagged behavior on
    // hydration/refetch.
    queryFn: function queryFn(): Promise<SubscriptionQueryData> {
      return fetch(false);
    },
    staleTime: STALE_TIME,
  });
}
