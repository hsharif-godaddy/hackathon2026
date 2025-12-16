import { useQuery } from '@tanstack/react-query';

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
 * @returns React Query result with commits data and query state
 *
 * @example
 * ```typescript
 * const { data: commits = [], isLoading, error, refetch } = useGitHistoryQuery({
 *   appId: 'my-app-123',
 *   enabled: true
 * });
 * ```
 */
export function useGitHistoryQuery(options: UseGitHistoryQueryOptions) {
  const { appId, enabled = true } = options;

  return useQuery({
    queryKey: ['git-history', appId],
    queryFn: async function fetchGitHistory() {
      if (!appId) {
        throw new Error('App ID is required');
      }

      const { commits } = await appService.getGitHistory(appId);
      return commits || [];
    },
    enabled: enabled && !!appId,
    staleTime: 0, // Always consider stale - refetch on invalidation to get latest commits
    retry: 2, // Retry up to 2 times
    refetchOnWindowFocus: false,
  });
}

