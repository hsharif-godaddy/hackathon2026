import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

/**
 * Fetch thumbnail for an app and return as object URL
 */
async function fetchThumbnail(siteId: string): Promise<string | null> {
  try {
    const apiUrl = await buildDynamicApiUrl('screenshot', siteId);

    const response = await agentFetch(apiUrl, {
      method: 'GET',
      siteId,
    });

    if (response.ok) {
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }

    if (response.status === 404) {
      // No thumbnail available - this is expected for new apps
      return null;
    }

    logger.warn('app-thumbnail.fetch.failed', {
      siteId,
      status: response.status,
    });

    return null;
  } catch (error) {
    // Site not ready, no agent_url, etc. - show fallback
    logger.debug('app-thumbnail.fetch.error', {
      siteId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * React Query hook for fetching and caching app thumbnails
 *
 * Features:
 * - Caches thumbnails per siteId (5 minute stale time)
 * - Deduplicates concurrent requests for the same siteId
 * - Shares cache across all components using the same siteId
 * - Cleans up object URLs when component unmounts or cache entry is replaced
 *
 * @param siteId - The app/site ID to fetch thumbnail for
 * @param enabled - Whether to fetch the thumbnail (default: true)
 *
 * @example
 * ```tsx
 * const { data: thumbnailUrl, isLoading, isError } = useAppThumbnail(siteId);
 * ```
 */
export function useAppThumbnail(siteId: string, enabled = true) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['app-thumbnail', siteId],
    queryFn: () => fetchThumbnail(siteId),
    enabled: enabled && !!siteId,
    staleTime: 5 * 60 * 1000, // 5 minutes - thumbnails don't change often
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes after last use
    retry: 1, // Only retry once for thumbnails
    refetchOnWindowFocus: false, // Don't refetch thumbnails on focus
  });

  // Clean up object URL when component unmounts or siteId changes
  useEffect(() => {
    return () => {
      const cachedUrl = queryClient.getQueryData<string | null>(['app-thumbnail', siteId]);
      if (cachedUrl) {
        // Only revoke if this is the last observer
        const queryState = queryClient.getQueryState(['app-thumbnail', siteId]);
        // Check if no other components are observing this query
        if (queryState && queryClient.getQueryCache().find({ queryKey: ['app-thumbnail', siteId] })?.getObserversCount() === 1) {
          URL.revokeObjectURL(cachedUrl);
        }
      }
    };
  }, [queryClient, siteId]);

  return query;
}
