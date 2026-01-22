import { useQuery } from '@tanstack/react-query';

import { type Subscription } from '@/types/credits';

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

interface UseActiveSubscriptionResult {
  data: Subscription | undefined;
  subscriptions: Subscription[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * React Query hook for fetching all subscriptions for the authenticated user
 *
 * This hook fetches all subscriptions and returns the first active one as `data`
 * for convenience, along with the full `subscriptions` array.
 * Useful for pages that need subscription info without an app context
 * (e.g., Manage Plan page).
 */
export function useActiveSubscription(): UseActiveSubscriptionResult {
  const query = useQuery({
    queryKey: ['subscriptions'],
    queryFn: async (): Promise<Subscription[]> => {
      const response = await fetch('/api/subscription/active', {
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.error || `Failed to fetch subscriptions: ${response.status}`;
        throw new HttpError(errorMessage, response.status);
      }

      if (data.success && Array.isArray(data.data)) {
        return data.data;
      }

      throw new Error(data.error || 'Failed to get subscription data');
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes
    retry: function retryOnError(failureCount, error) {
      // Don't retry on 4xx errors (client errors)
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: function calculateRetryDelay(attemptIndex) {
      return Math.min(1000 * 2 ** attemptIndex, 30000);
    },
  });

  // Find the first active subscription, or fall back to the first one
  const subscriptions = query.data || [];
  const activeSubscription = subscriptions.find(function findActive(sub) {
    return sub.status === 'active';
  }) || subscriptions[0];

  return {
    data: activeSubscription,
    subscriptions,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
