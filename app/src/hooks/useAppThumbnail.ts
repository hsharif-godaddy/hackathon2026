import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { buildAgentAppEndpointUrl, buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

/**
 * Fetch thumbnail for an app and return as object URL.
 * Accepts an AbortSignal so React Query can cancel in-flight requests
 * on unmount — preventing orphaned blob URLs that would never be revoked.
 */
async function fetchThumbnail(siteId: string, agentUrl?: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const apiUrl = agentUrl
      ? buildAgentAppEndpointUrl(agentUrl, siteId, 'screenshot')
      : await buildDynamicApiUrl('screenshot', siteId);

    const response = await agentFetch(apiUrl, {
      method: 'GET',
      siteId,
      signal,
    });

    if (signal?.aborted) return null;

    if (response.ok) {
      const blob = await response.blob();
      if (signal?.aborted) return null;
      return URL.createObjectURL(blob);
    }

    if (response.status === 404) {
      return null;
    }

    logger.warn('app-thumbnail.fetch.failed', {
      siteId,
      status: response.status,
    });

    return null;
  } catch (error) {
    if (signal?.aborted) return null;
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
    queryFn: ({ signal }) => fetchThumbnail(siteId, normalizedAgentUrl, signal),
    enabled: enabled && !!siteId,
    staleTime: 5 * 60 * 1000, // 5 minutes - thumbnails don't change often
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes after last use
    retry: 1, // Only retry once for thumbnails
    refetchOnWindowFocus: false, // Don't refetch thumbnails on focus
  });

  // useQuery unsubscribes before this cleanup runs, so observer count is
  // already decremented. Revoke only when no observers remain (=== 0).
  useEffect(() => {
    const queryKey = ['app-thumbnail', siteId, cacheKeySuffix];
    return () => {
      const cachedUrl = queryClient.getQueryData<string | null>(queryKey);
      if (cachedUrl) {
        const entry = queryClient.getQueryCache().find({ queryKey });
        if (entry && entry.getObserversCount() === 0) {
          URL.revokeObjectURL(cachedUrl);
          queryClient.removeQueries({ queryKey });
        }
      }
    };
  }, [queryClient, siteId, cacheKeySuffix]);

  return query;
}
