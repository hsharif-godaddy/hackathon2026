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

export class SubscriptionQueryError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = 'SubscriptionQueryError';
  }
}

export function shouldRetrySubscriptionQuery(failureCount: number, error: Error): boolean {
  if (
    error instanceof SubscriptionQueryError &&
    error.statusCode &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return false;
  }
  return failureCount < 3;
}

export async function fetchSubscriptionByAppId(appId: string | undefined): Promise<SubscriptionData> {
  if (!appId) {
    throw new Error('appId is required');
  }

  logger.info('subscription.query.start', { appId });

  const url = `/api/apps/${appId}/subscription`;

  const response = await fetch(url, {
    credentials: 'include',
  });

  if (!response.ok) {
    let errorMessage = `Failed to fetch subscription data: ${response.status}`;

    try {
      const data = await response.json();
      errorMessage = data.error || errorMessage;
    } catch {
      // Non-JSON error responses still need to preserve the HTTP status.
    }

    logger.error('subscription.query.error', {
      appId,
      statusCode: response.status,
      error: errorMessage
    });
    throw new SubscriptionQueryError(errorMessage, response.status);
  }

  const data = await response.json();

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
}

export const useSubscriptionByAppId = (appId: string | undefined): UseSubscriptionByAppIdResult => {
  return useQuery<SubscriptionData, Error>({
    queryKey: ['subscription', appId],
    queryFn: () => fetchSubscriptionByAppId(appId),
    enabled: !!appId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes
    retry: shouldRetrySubscriptionQuery,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
};
