'use client';

import { useQuery } from '@tanstack/react-query';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

export interface ConversationsBrandData {
  brandId: string | null;
}

/**
 * React Query hook for fetching the Conversations brand ID for an app.
 *
 * Uses TanStack Query for automatic caching, background refetching, and deduplication.
 * The brand ID is cached and shared across components for the same appId.
 *
 * @param appId - App ID (optional)
 * @returns Query result with brandId, isLoading, error, and refetch function
 *
 * @example
 * ```typescript
 * const { brandId, isLoading, error } = useConversationsBrandId(appId);
 * ```
 */
export function useConversationsBrandId(appId: string | undefined) {
  const query = useQuery({
    queryKey: ['conversations-brand-id', appId],
    queryFn: async (): Promise<ConversationsBrandData> => {
      if (!appId) {
        return { brandId: null };
      }

      logger.debug('conversations-brand-id.fetch.start', {
        message: 'Fetching conversations brand ID via React Query',
        appId,
      });

      const url = await buildDynamicApiUrl('conversation-brand-id', appId);
      const response = await agentFetch(url, { siteId: appId });

      if (!response.ok) {
        const errorMessage = `Failed to fetch conversation brand ID: ${response.status} ${response.statusText}`.trim();
        logger.error('conversations-brand-id.fetch.failure', {
          message: errorMessage,
          appId,
        });
        throw new Error(errorMessage);
      }

      const data = await response.json() as ConversationsBrandData;

      logger.info('conversations-brand-id.fetch.success', {
        brandId: data.brandId,
        appId,
      });

      return data;
    },
    enabled: !!appId,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    retry: 1,
  });

  return {
    brandId: query.data?.brandId ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
