import { useMutation, useQueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';
import { appService, type RestoreNotice } from '@/services/AppService';
import { useCodeSyncStore } from '@/stores/useCodeSyncStore';
import { useFileTreeStore } from '@/stores/useFileTreeStore';

interface RestoreCommitVariables {
  appId: string;
  /** Omit for a stash-only rewind (no rollback target). */
  commitHash?: string;
}

export interface RestoreCommitResult {
  hasChanges: boolean;
  stashHash: string | null;
  /** Persisted user-action notice; callers mirror into the conversation store. */
  notice: RestoreNotice | null;
}

/** React Query mutation for `/git/restore`. Backs per-prompt Restore + chat Undo. */
export function useRestoreCommitMutation() {
  const queryClient = useQueryClient();

  return useMutation<RestoreCommitResult, Error, RestoreCommitVariables>({
    mutationFn: async function restoreCommit({ appId, commitHash }: RestoreCommitVariables): Promise<RestoreCommitResult> {
      if (!appId) {
        throw new Error('appId is required');
      }

      logger.info('restore-commit-mutation.start', {
        appId,
        commitHash: commitHash ? commitHash.substring(0, 7) : null,
      });

      const response = await appService.restoreCommit(appId, commitHash);

      logger.info('restore-commit-mutation.success', {
        appId,
        commitHash: commitHash ? commitHash.substring(0, 7) : null,
        hasChanges: response.hasChanges,
        stashHash: response.stashHash ? response.stashHash.substring(0, 7) : null,
        noticeId: response.notice?.id ?? null,
      });

      return {
        hasChanges: response.hasChanges,
        stashHash: response.stashHash,
        notice: response.notice,
      };
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['git-history', variables.appId],
        refetchType: 'active',
      });

      // Tree was rewritten outside the tool-call path; refresh + flag so the
      // editor's conflict-banner path picks up open-file divergence.
      void useFileTreeStore.getState().loadFiles(variables.appId);
      useCodeSyncStore.getState().signalRestore();

      // Force preview reload — Vite HMR alone is racy for back-to-back rewinds.
      if (typeof window !== 'undefined') {
        window.postMessage({ type: 'preview-refresh' }, window.location.origin);
      }
    },
    onError: (error, variables) => {
      logger.error('restore-commit-mutation.error', {
        appId: variables.appId,
        commitHash: variables.commitHash,
        error: error.message,
      });
    },
  });
}
