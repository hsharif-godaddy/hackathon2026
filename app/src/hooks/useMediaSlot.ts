import { useQuery } from '@tanstack/react-query';

import type { GetSlotResponse, MediaSlot } from '@/app/[market]/develop/components/media/types';
import { dynamicApiConfigService } from '@/config/dynamic-api';
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
  /** The slot data */
  slot: MediaSlot | null;
  /** Whether the data is loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refetch the slot data */
  refetch: () => Promise<void>;
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

        const response = await fetch(
          `${apiConfig.agentUrl}/media/${appId}/slots/${slotName}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${tokenResult.token}`,
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `Failed to fetch slot: ${response.status}`);
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
    staleTime: 0, // Always fetch fresh data
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
  });

  return {
    slot: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: async () => {
      await query.refetch();
    },
  };
}
