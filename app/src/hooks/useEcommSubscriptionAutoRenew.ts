import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

interface SetAutoRenewParams {
  builderEntitlementId: string;
  autoRenew: boolean;
}

interface SetAutoRenewResult {
  success: boolean;
  renewalDate?: string;
}

/**
 * Hook for toggling autoRenew on the ecomm subscription
 *
 * - autoRenew: false = schedule downgrade to Free at next renewal
 * - autoRenew: true = cancel scheduled downgrade
 */
export function useEcommSubscriptionAutoRenew() {
  const queryClient = useQueryClient();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const setAutoRenew = useMutation<SetAutoRenewResult, Error, SetAutoRenewParams>({
    mutationFn: async ({ builderEntitlementId, autoRenew }): Promise<SetAutoRenewResult> => {
      if (!builderEntitlementId) {
        throw new Error('builderEntitlementId is required');
      }

      const response = await appFetch('/api/ecomm-subscription/auto-renew', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ builderEntitlementId, autoRenew }),
        credentials: 'include',
      });

      let data: { error?: string; renewalDate?: string } | undefined;
      let responseText: string | undefined;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          data = await response.json();
        } catch {
          data = undefined;
        }
      } else {
        try {
          responseText = await response.text();
        } catch {
          responseText = undefined;
        }
      }

      if (!response.ok) {
        const errorMessage =
          data?.error ||
          responseText ||
          `Failed to update auto-renew: ${response.status}`;
        logger.error('ecomm-subscription.auto-renew.mutation.error', {
          builderEntitlementId,
          autoRenew,
          statusCode: response.status,
          error: errorMessage,
        });
        const error = new Error(errorMessage) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      return {
        success: true,
        renewalDate: data?.renewalDate,
      };
    },
    onSuccess: (_data, variables) => {
      // Optimistically update the cache with the new autoRenew value
      // (API has eventual consistency, so refetch might return stale data)
      queryClient.setQueryData(
        ['ecomm-subscription-status', variables.builderEntitlementId],
        (oldData: { autoRenew: boolean; paidThroughDate?: string; subscriptionId?: string } | undefined) => {
          if (!oldData) {return oldData;}
          return {
            ...oldData,
            autoRenew: variables.autoRenew,
          };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      // Invalidate status query after delay to sync with server once eventual consistency settles
      // Clear any existing timeout before setting a new one
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['ecomm-subscription-status', variables.builderEntitlementId] });
        timeoutRef.current = null;
      }, 5000);
    },
    onError: (error, variables) => {
      logger.error('ecomm-subscription.auto-renew.mutation.failed', {
        builderEntitlementId: variables.builderEntitlementId,
        autoRenew: variables.autoRenew,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors
      const status = (error as Error & { status?: number })?.status;
      if (status && status >= 400 && status < 500) {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  return { setAutoRenew };
}
