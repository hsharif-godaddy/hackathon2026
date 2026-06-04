'use client';

import { useQuery } from '@tanstack/react-query';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

export interface InboxAccountData {
  accountId: string | null;
  brandId: string | null;
}

/**
 * React Query hook for fetching the Conversations account data (brandId and accountId) for an app.
 *
 * Uses TanStack Query for automatic caching, background refetching, and deduplication.
 * The account data is cached and shared across components for the same appId.
 *
 * @param appId - App ID (optional)
 * @returns Query result with brandId, accountId, isLoading, error, and refetch function
 *
 * @example
 * ```typescript
 * const { brandId, accountId, isLoading, error } = useConversationsAccount(appId);
 * ```
 */

export function useInboxAccount(appId: string | undefined) {
  const query = useQuery({
    queryKey: ['inbox-account', appId],
    queryFn: async (): Promise<InboxAccountData> => {
      if (!appId) {
        return { accountId: null, brandId: null };
      }

      logger.debug('inbox-account.fetch.start', {
        message: 'Fetching inbox account data via React Query',
        appId,
      });

      const url = await buildDynamicApiUrl('inbox-account', appId);
      const response = await agentFetch(url, { siteId: appId });

      if (!response.ok) {
        const errorMessage = `Failed to fetch inbox account data: ${response.status} ${response.statusText}`.trim();
        logger.error('inbox-account.fetch.failure', {
          message: errorMessage,
          appId,
        });
        throw new Error(errorMessage);
      }

      const data = await response.json() as InboxAccountData;

      logger.info('inbox-account.fetch.success', {
        accountId: data.accountId,
        brandId: data.brandId,
        appId,
      });

      return data;
    },
    enabled: !!appId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    accountId: query.data?.accountId ?? null,
    brandId: query.data?.brandId ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
