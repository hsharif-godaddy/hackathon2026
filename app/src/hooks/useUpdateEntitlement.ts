import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/lib/request-context';

interface UpdateEntitlementParams {
  subscriptionId: string;
  entitlementId: string;
}

interface UpdateEntitlementResult {
  success: boolean;
  message?: string;
  data?: {
    subscription: any;
    subscriptionId: string;
    entitlementId: string;
  };
  error?: string;
  statusCode?: number;
}

export const useUpdateEntitlement = () => {
  const queryClient = useQueryClient();

  return useMutation<UpdateEntitlementResult, Error, UpdateEntitlementParams>({
    mutationFn: async ({ subscriptionId, entitlementId }: UpdateEntitlementParams): Promise<UpdateEntitlementResult> => {
      if (!subscriptionId || !entitlementId) {
        throw new Error('subscriptionId and entitlementId are required');
      }

      logger.info('update-entitlement.mutation.start', {
        subscriptionId,
        entitlementId
      });

      const url = `/api/entitlements/${encodeURIComponent(subscriptionId)}/update`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entitlementId }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.error || `Failed to update entitlement: ${response.status}`;
        logger.error('update-entitlement.mutation.error', {
          subscriptionId,
          entitlementId,
          statusCode: response.status,
          error: errorMessage
        });
        throw new Error(errorMessage);
      }

      if (data.success && data.data) {
        logger.info('update-entitlement.mutation.success', {
          subscriptionId,
          entitlementId,
          newEntitlementId: data.data.entitlementId
        });
        return {
          success: true,
          message: data.message,
          data: data.data
        };
      } else {
        const errorMessage = data.error || 'Failed to update entitlement';
        logger.error('update-entitlement.mutation.failed', {
          subscriptionId,
          entitlementId,
          error: errorMessage
        });
        throw new Error(errorMessage);
      }
    },
    onSuccess: (result, variables) => {
      logger.info('update-entitlement.mutation.completed', {
        subscriptionId: variables.subscriptionId,
        entitlementId: variables.entitlementId,
        success: result.success
      });

      // Invalidate related queries that might be affected by the entitlement update
      queryClient.invalidateQueries({
        queryKey: ['subscription']
      });
      queryClient.invalidateQueries({
        queryKey: ['entitlements-by-subscription']
      });
      queryClient.invalidateQueries({
        queryKey: ['matching-project']
      });
    },
    onError: (error, variables) => {
      logger.error('update-entitlement.mutation.failed-completely', {
        subscriptionId: variables.subscriptionId,
        entitlementId: variables.entitlementId,
        error: error instanceof Error ? error.message : String(error)
      });
    },
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors (client errors like validation failures)
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return failureCount < 2; // Retry up to 2 times for server errors
    },
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};
