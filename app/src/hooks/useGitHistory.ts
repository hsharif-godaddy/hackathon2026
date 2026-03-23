import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { appService } from '@/services/AppService';

/**
 * Git commit interface
 */
export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Options for useGitHistoryQuery hook
 */
export interface UseGitHistoryQueryOptions {
  appId: string;
  enabled?: boolean;
  offset?: number;
}

/**
 * Git history query result
 */
export interface GitHistoryQueryResult {
  commits: GitCommit[];
  currentCommit: string | null;
  hasMore: boolean;
}

/**
 * React Query hook for fetching git history data
 *
 * Uses TanStack Query for automatic caching, background refetching, and error handling.
 * Includes built-in retry logic with progressive delays for newly created apps.
 *
 * @param options - Configuration options
 * @param options.appId - App ID (required)
 * @param options.enabled - Whether the query should be enabled (default: true)
 * @returns React Query result with commits data, currentCommit, and query state
 *
 * @example
 * ```typescript
 * const { data, isLoading, error, refetch } = useGitHistoryQuery({
 *   appId: 'my-app-123',
 *   enabled: true
 * });
 * const commits = data?.commits || [];
 * const currentCommit = data?.currentCommit;
 * ```
 */
export function useGitHistoryQuery(options: UseGitHistoryQueryOptions) {
  const { appId, enabled = true, offset = 0 } = options;
  const queryClient = useQueryClient();
  const prevAppIdRef = useRef(appId);

  // Cancel in-flight queries for the PREVIOUS appId when appId changes
  // This prevents "old appId with new agent URL" race condition during app transitions
  useEffect(() => {
    if (prevAppIdRef.current && prevAppIdRef.current !== appId) {
      queryClient.cancelQueries({ queryKey: ['git-history', prevAppIdRef.current] });
    }
    prevAppIdRef.current = appId;
  }, [appId, queryClient]);

  return useQuery({
    queryKey: ['git-history', appId, offset],
    queryFn: async function fetchGitHistory(): Promise<GitHistoryQueryResult> {
      if (!appId) {
        throw new Error('App ID is required');
      }

      const { commits, currentCommit, hasMore } = await appService.getGitHistory(appId, offset);
      return {
        commits: commits || [],
        currentCommit: currentCommit || null,
        hasMore,
      };
    },
    enabled: enabled && !!appId,
    staleTime: 0, // Always consider stale - refetch on invalidation to get latest commits
    retry: 2, // Retry up to 2 times
    refetchOnWindowFocus: false,
  });
}

