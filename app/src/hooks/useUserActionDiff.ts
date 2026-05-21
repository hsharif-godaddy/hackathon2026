import { useQuery } from '@tanstack/react-query';

import { appService } from '@/services/AppService';

export interface UseUserActionDiffOptions {
  appId: string;
  commitHash?: string | null;
  stashHash?: string | null;
  /** Lets the renderer keep the query dormant until the modal opens. */
  enabled?: boolean;
}

export interface UserActionDiffResult {
  diff: string | null;
  diffTruncated: boolean;
}

/**
 * React Query hook for the lazy `/git/diff` endpoint. Returns the combined
 * stash + commit diff for a user-action notice, fetched on demand when the
 * `UserActionDiffRenderer` modal opens.
 *
 * The (commitHash, stashHash) pair is immutable once a notice has been
 * persisted, so `staleTime: Infinity` — refetching would burn CPU on the
 * agents container for an answer that cannot change.
 */
export function useUserActionDiffQuery(options: UseUserActionDiffOptions) {
  const { appId, commitHash, stashHash, enabled = true } = options;
  const hasAnyHash = Boolean(commitHash || stashHash);

  return useQuery<UserActionDiffResult>({
    queryKey: ['user-action-diff', appId, commitHash ?? null, stashHash ?? null],
    queryFn: async function fetchUserActionDiff(): Promise<UserActionDiffResult> {
      if (!appId) {
        throw new Error('App ID is required');
      }
      return appService.getUserActionDiff(appId, {
        ...(commitHash ? { commitHash } : {}),
        ...(stashHash ? { stashHash } : {}),
      });
    },
    enabled: enabled && Boolean(appId) && hasAnyHash,
    staleTime: Infinity,
    retry: 2,
    refetchOnWindowFocus: false,
  });
}
