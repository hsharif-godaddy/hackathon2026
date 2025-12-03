import { useQuery } from '@tanstack/react-query';
import { logger } from '@/lib/request-context';

interface EntitlementsData {
  subscription: any;
  subscriptionId: string;
  entitlementId: string;
}

interface UseEntitlementsBySubscriptionIdResult {
  data: EntitlementsData | undefined;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export const useEntitlementsBySubscriptionId = (subscriptionId: string | undefined): UseEntitlementsBySubscriptionIdResult => {
  return useQuery({
    queryKey: ['entitlements-by-subscription', subscriptionId],
    queryFn: async (): Promise<EntitlementsData> => {
      if (!subscriptionId) {
        throw new Error('No subscription ID found for this app');
      }

      logger.info('entitlements-by-subscription.query.start', { subscriptionId });

      const url = `/api/entitlements?subscriptionId=${encodeURIComponent(subscriptionId)}`;

      const response = await fetch(url, {
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = `API request failed: ${response.status} ${response.statusText} - ${JSON.stringify(data)}`;
        logger.error('entitlements-by-subscription.query.error', {
          subscriptionId,
          statusCode: response.status,
          error: errorMessage,
          originalResponse: data
        });
        throw new Error(errorMessage);
      }

      if (data.success && data.data?.subscription) {
        logger.info('entitlements-by-subscription.query.success', {
          subscriptionId,
          entitlementId: data.data.subscription.entitlementId
        });
        return {
          subscription: data.data.subscription,
          subscriptionId: data.data.subscriptionId,
          entitlementId: data.data.subscription.entitlementId
        };
      } else {
        const errorMessage = `API request failed: ${response.status} ${response.statusText} - ${JSON.stringify(data)}`;
        logger.error('entitlements-by-subscription.query.failed', {
          subscriptionId,
          error: errorMessage,
          originalResponse: data
        });
        throw new Error(errorMessage);
      }
    },
    enabled: !!subscriptionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors (client errors)
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
};
