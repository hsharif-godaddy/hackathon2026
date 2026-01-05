import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { GitCommit } from '@/hooks/useGitHistory';
import { logger } from '@/lib/request-context';
import { appService } from '@/services/AppService';
import { useGitStore } from '@/stores/useGitStore';

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
  const selectCommit = useGitStore((state) => state.selectCommit);

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
      logger.info('restore-commit-mutation.invalidate-start', {
        message: 'Invalidating and refetching git history after restore',
        appId: variables.appId,
      });

      // Invalidate first - this triggers refetch in all active useGitHistoryQuery hooks
      // and waits for them to complete
      await queryClient.invalidateQueries({ 
        queryKey: ['git-history', variables.appId],
        refetchType: 'active'
      });

      // Now fetch the fresh data to get the new commit hash for selection
      const gitHistory = await queryClient.fetchQuery({
        queryKey: ['git-history', variables.appId],
        queryFn: async () => {
          const { commits, currentCommit } = await appService.getGitHistory(variables.appId);
          return { commits: commits || [], currentCommit: currentCommit || null };
        }
      });
      
      logger.info('restore-commit-mutation.refetch-complete', {
        message: 'Git history refetched',
        appId: variables.appId,
        commitCount: gitHistory.commits.length,
      });

      // Now that all components have fresh data, select the new commit
      if (gitHistory && gitHistory.commits.length > 0) {
        await selectCommit(variables.appId, gitHistory.commits[0].hash);
        logger.info('restore-commit-mutation.new-commit-selected', {
          message: 'Selected newly restored commit',
          appId: variables.appId,
          commitHash: gitHistory.commits[0].hash.substring(0, 7),
        });
      }
      
      logger.info('restore-commit-mutation.complete', {
        message: 'Restore complete and new commit selected',
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

