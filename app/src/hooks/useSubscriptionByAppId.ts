import { useQuery } from '@tanstack/react-query';
import { logger } from '@/lib/request-context';

interface SubscriptionData {
  app: any;
  subscription: any;
  system: any;
}

interface UseSubscriptionByAppIdResult {
  data: SubscriptionData | undefined;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export const useSubscriptionByAppId = (appId: string | undefined): UseSubscriptionByAppIdResult => {
  return useQuery({
    queryKey: ['subscription', appId],
    queryFn: async (): Promise<SubscriptionData> => {
      if (!appId) {
        throw new Error('appId is required');
      }

      logger.info('subscription.query.start', { appId });

      const url = `/api/apps/${appId}/subscription`;

      const response = await fetch(url, {
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.error || `Failed to fetch subscription data: ${response.status}`;
        logger.error('subscription.query.error', {
          appId,
          statusCode: response.status,
          error: errorMessage
        });
        throw new Error(errorMessage);
      }

      if (data.success && data.data) {
        logger.info('subscription.query.success', {
          appId,
          subscriptionId: data.data.subscription?.id,
          systemId: data.data.system?.systemId
        });
        return {
          app: data.data.app,
          subscription: data.data.subscription,
          system: data.data.system
        };
      } else {
        const errorMessage = data.error || 'Failed to get subscription data';
        logger.error('subscription.query.failed', {
          appId,
          error: errorMessage
        });
        throw new Error(errorMessage);
      }
    },
    enabled: !!appId,
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
