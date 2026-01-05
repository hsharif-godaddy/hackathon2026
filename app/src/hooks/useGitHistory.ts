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
 * Git history query result
 */
export interface GitHistoryQueryResult {
  commits: GitCommit[];
  currentCommit: string | null;
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
  const { appId, enabled = true } = options;

  return useQuery({
    queryKey: ['git-history', appId],
    queryFn: async function fetchGitHistory(): Promise<GitHistoryQueryResult> {
      if (!appId) {
        throw new Error('App ID is required');
      }

      const { commits, currentCommit } = await appService.getGitHistory(appId);
      return {
        commits: commits || [],
        currentCommit: currentCommit || null,
      };
    },
    enabled: enabled && !!appId,
    staleTime: 0, // Always consider stale - refetch on invalidation to get latest commits
    retry: 2, // Retry up to 2 times
    refetchOnWindowFocus: false,
  });
}

