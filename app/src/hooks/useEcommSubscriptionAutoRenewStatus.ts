import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';

interface EcommSubscriptionTerm {
  termType: string;
  numberOfTerms: number;
}

export interface EcommSubscriptionStatus {
  autoRenew: boolean;
  paidThroughDate?: string;
  subscriptionId?: string;
  term?: EcommSubscriptionTerm;
}

const STALE_TIME = 5 * 1000; // 5 seconds
const GC_TIME = 30 * 1000; // 30 seconds

/**
 * Fetch the autoRenew status for a given entitlement ID.
 * Shared between the query hook and the mutation reconcile logic.
 */
export async function fetchEcommSubscriptionStatus(builderEntitlementId: string): Promise<EcommSubscriptionStatus> {
  const response = await appFetch(
    `/api/ecomm-subscription/status?builderEntitlementId=${encodeURIComponent(builderEntitlementId)}`,
    {
      credentials: 'include',
    }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to fetch subscription status: ${response.status}`);
  }

  return response.json();
}

/**
 * Hook to fetch the autoRenew status of the ecomm subscription
 * associated with a builder entitlement.
 */
export function useEcommSubscriptionAutoRenewStatus(builderEntitlementId?: string | null) {
  return useQuery<EcommSubscriptionStatus>({
    queryKey: ['ecomm-subscription-status', builderEntitlementId],
    queryFn: () => {
      if (!builderEntitlementId) {
        throw new Error('builderEntitlementId is required');
      }
      return fetchEcommSubscriptionStatus(builderEntitlementId);
    },
    enabled: !!builderEntitlementId,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}
