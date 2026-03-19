/**
 * Entitlements Hook
 *
 * Fetches entitlement data for a subscription.
 */

import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';

export const ENTITLEMENTS_QUERY_KEY = ['entitlements'] as const;
export const ENTITLEMENTS_STALE_TIME = 30000;

async function fetchEntitlements(subscriptionId: string): Promise<string | null> {
  const response = await appFetch(`/api/entitlements?subscriptionId=${encodeURIComponent(subscriptionId)}`, { credentials: 'include' });
  if (!response.ok) {return null;}
  const data = await response.json();
  return data?.data?.subscription?.entitlementId ?? null;
}

interface UseEntitlementsOptions {
  subscriptionId?: string;
  enabled?: boolean;
}

export function useEntitlements(options: UseEntitlementsOptions) {
  const { subscriptionId, enabled = true } = options;

  return useQuery({
    queryKey: [...ENTITLEMENTS_QUERY_KEY, subscriptionId],
    queryFn: () => fetchEntitlements(subscriptionId!),
    staleTime: ENTITLEMENTS_STALE_TIME,
    enabled: enabled && !!subscriptionId,
  });
}

export { fetchEntitlements };
