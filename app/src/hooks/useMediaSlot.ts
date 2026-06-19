import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { GetSlotResponse, MediaSlot } from '@/app/[market]/develop/components/media/types';
import { dynamicApiConfigService } from '@/config/dynamic-api';
import {
  mediaFetchRetry,
  mediaFetchRetryDelay,
  resolveBaseAgentUrl,
  throwIfMediaFetchNotOk,
} from '@/hooks/media-fetch-utils';
import { regenerateToken } from '@/lib/jwt-regeneration';
import { logger } from '@/lib/request-context';

interface UseMediaSlotOptions {
  /** App ID */
  appId: string | null;
  /** Slot name (e.g., "pages/home/hero") */
  slotName: string | null;
  /** Whether to enable the query */
  enabled?: boolean;
}

interface UseMediaSlotResult {
  /** The slot data from the latest successful fetch (null until first success) */
  slot: MediaSlot | null;
  /** Whether the initial fetch is in progress with no cached data */
  isLoading: boolean;
  /** Whether a fetch (including background retry) is in progress */
  isFetching: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refetch the slot data */
  refetch: () => Promise<void>;
  /** Update the cached slot data directly (avoids redundant network refetch) */
  setSlotData: (slot: MediaSlot) => void;
}

/**
 * Hook to fetch media slot data from the API
 *
 * Fetches fresh slot data instead of relying on stale tool call results.
 * Uses React Query with staleTime: 0 to always refetch when dialog opens.
 *
 * @example
 * ```tsx
 * const { slot, isLoading, error, refetch } = useMediaSlot({
 *   appId: 'abc123',
 *   slotName: 'pages/home/hero',
 *   enabled: isDialogOpen,
 * });
 * ```
 */
export function useMediaSlot({
  appId,
  slotName,
  enabled = true,
}: UseMediaSlotOptions): UseMediaSlotResult {
  const queryClient = useQueryClient();
  const queryKey = ['mediaSlot', appId, slotName];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<MediaSlot | null> => {
      if (!appId || !slotName) {
        return null;
      }

      logger.info('hook.media_slot.fetch.start', { appId, slotName });

      try {
        const tokenResult = await regenerateToken({ siteId: appId, force: true });
        const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available');
        }

        const baseAgentUrl = resolveBaseAgentUrl(apiConfig.agentUrl, appId);

        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${tokenResult.token}`,
            },
          }
        );

        if (!response.ok) {
          await throwIfMediaFetchNotOk(response, 'slot');
        }

        const data: GetSlotResponse = await response.json();

        if (!data.success || !data.slot) {
          throw new Error(data.error || 'Failed to get slot data');
        }

        logger.info('hook.media_slot.fetch.success', { appId, slotName });
        return data.slot;
      } catch (error) {
        logger.error('hook.media_slot.fetch.error', {
          appId,
          slotName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    enabled: enabled && !!appId && !!slotName,
    staleTime: 30_000, // Fresh for 30s; mutations update cache directly
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: mediaFetchRetry,
    retryDelay: mediaFetchRetryDelay,
  });

  return {
    slot: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: async () => {
      await query.refetch();
    },
    setSlotData: (slot: MediaSlot) => {
      queryClient.setQueryData(queryKey, slot);
    },
  };
}
