import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';

interface EcommSubscriptionStatus {
  autoRenew: boolean;
  paidThroughDate?: string;
  subscriptionId?: string;
}

const STALE_TIME = 30 * 1000; // 30 seconds
const GC_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Hook to fetch the autoRenew status of the ecomm subscription
 * associated with a builder entitlement.
 */
export function useEcommSubscriptionAutoRenewStatus(builderEntitlementId?: string | null) {
  return useQuery<EcommSubscriptionStatus>({
    queryKey: ['ecomm-subscription-status', builderEntitlementId],
    queryFn: async () => {
      if (!builderEntitlementId) {
        throw new Error('builderEntitlementId is required');
      }

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
    },
    enabled: !!builderEntitlementId,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}
