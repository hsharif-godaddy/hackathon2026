import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appService } from '@/services/AppService';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logger } from '@/lib/request-context';
import type { GitCommit } from '@/hooks/useGitHistory';

interface RestoreCommitVariables {
  appId: string;
  commitHash: string;
}

/**
 * React Query mutation hook for restoring a git commit
 * 
 * Handles restoring files from a specific commit and automatically
 * invalidates the git history cache on success to reflect the new commit
 * that gets created from the restore operation.
 * 
 * @returns Mutation object with mutate, isPending, isError, error properties
 * 
 * @example
 * ```typescript
 * const restoreMutation = useRestoreCommitMutation();
 * 
 * function handleRestore() {
 *   restoreMutation.mutate(
 *     { appId: 'app-123', commitHash: 'abc123' },
 *     {
 *       onSuccess: () => {
 *         console.log('Commit restored successfully');
 *       },
 *       onError: (error) => {
 *         console.error('Restore failed:', error);
 *       }
 *     }
 *   );
 * }
 * ```
 */
export function useRestoreCommitMutation() {
  const queryClient = useQueryClient();
  const setSelectedCommit = useDevelopPageStore((state) => state.setSelectedCommit);

  return useMutation<void, Error, RestoreCommitVariables>({
    mutationFn: async function restoreCommit({ appId, commitHash }: RestoreCommitVariables): Promise<void> {
      if (!appId || !commitHash) {
        throw new Error('appId and commitHash are required');
      }

      logger.info('restore-commit-mutation.start', {
        message: 'Starting commit restore',
        appId,
        commitHash,
      });

      await appService.restoreCommit(appId, commitHash);

      logger.info('restore-commit-mutation.success', {
        message: 'Commit restored successfully',
        appId,
        commitHash,
      });
    },
    onSuccess: async (_, variables) => {
      // Invalidate and refetch git history to get the new commit created by restore
      await queryClient.invalidateQueries({ 
        queryKey: ['git-history', variables.appId],
        refetchType: 'active'
      });
      
      // Get the refreshed git history and select the new commit (at index 0)
      const gitHistory = queryClient.getQueryData<GitCommit[]>(['git-history', variables.appId]);
      if (gitHistory && gitHistory.length > 0) {
        // Select the newly created commit
        setSelectedCommit(gitHistory[0]);
        logger.info('restore-commit-mutation.new-commit-selected', {
          message: 'Selected newly restored commit',
          appId: variables.appId,
          commitHash: gitHistory[0].hash.substring(0, 7),
        });
      } else {
        // Fallback: clear selection if no commits found
        setSelectedCommit(null);
      }
      
      logger.info('restore-commit-mutation.complete', {
        message: 'Git history cache refreshed after restore',
        appId: variables.appId,
      });
    },
    onError: (error, variables) => {
      logger.error('restore-commit-mutation.error', {
        message: 'Failed to restore commit',
        appId: variables.appId,
        commitHash: variables.commitHash,
        error: error.message,
      });
    },
  });
}

