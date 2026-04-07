import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { buildAgentAppEndpointUrl, buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

/**
 * Fetch thumbnail for an app and return as object URL
 */
async function fetchThumbnail(siteId: string, agentUrl?: string): Promise<string | null> {
  try {
    const apiUrl = agentUrl
      ? buildAgentAppEndpointUrl(agentUrl, siteId, 'screenshot')
      : await buildDynamicApiUrl('screenshot', siteId);

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
 * @param agentUrl - Optional agent base URL from list payload; when set, avoids GET /api/sites/:id
 *
 * @example
 * ```tsx
 * const { data: thumbnailUrl, isLoading, isError } = useAppThumbnail(siteId);
 * ```
 */
export function useAppThumbnail(siteId: string, enabled = true, agentUrl?: string) {
  const queryClient = useQueryClient();
  const normalizedAgentUrl = agentUrl?.trim() || undefined;
  const cacheKeySuffix = normalizedAgentUrl ?? '';

  const query = useQuery({
    queryKey: ['app-thumbnail', siteId, cacheKeySuffix],
    queryFn: () => fetchThumbnail(siteId, normalizedAgentUrl),
    enabled: enabled && !!siteId,
    staleTime: 5 * 60 * 1000, // 5 minutes - thumbnails don't change often
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes after last use
    retry: 1, // Only retry once for thumbnails
    refetchOnWindowFocus: false, // Don't refetch thumbnails on focus
  });

  useEffect(() => {
    const thumbKey = ['app-thumbnail', siteId, cacheKeySuffix] as const;
    return () => {
      const cachedUrl = queryClient.getQueryData<string | null>(thumbKey);
      if (cachedUrl) {
        const queryState = queryClient.getQueryState(thumbKey);
        if (queryState && queryClient.getQueryCache().find({ queryKey: [...thumbKey] })?.getObserversCount() === 1) {
          URL.revokeObjectURL(cachedUrl);
        }
      }
    };
  }, [queryClient, siteId, cacheKeySuffix]);

  return query;
}
