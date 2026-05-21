import { useMutation, useQueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';
import { appService, type RestoreNotice } from '@/services/AppService';
import { useCodeSyncStore } from '@/stores/useCodeSyncStore';
import { useFileTreeStore } from '@/stores/useFileTreeStore';

interface RestoreCommitVariables {
  appId: string;
  /** Target commit. Omit (or pass undefined) to do a stash-only rewind — used
   *  by the chat undo button mid-stream / on a dirty tree where there is no
   *  older commit to target. */
  commitHash?: string;
}

export interface RestoreCommitResult {
  /** Whether any uncommitted changes were stashed by this call. */
  hasChanges: boolean;
  /** Stash commit hash when one was created (i.e., tree had uncommitted work). */
  stashHash: string | null;
  /** Persisted user-action notice produced by the rewind. Callers mirror
   *  this row into `useStreamingConversationStore` so the transcript reflects
   *  the rollback without a re-fetch. Null when persistence was skipped
   *  (e.g. no active conversation) or failed silently. */
  notice: RestoreNotice | null;
}

/**
 * React Query mutation for the unified `/git/restore` endpoint.
 *
 * The endpoint always stashes uncommitted changes first, then optionally
 * rewinds onto a target commit. This single hook backs both the per-prompt
 * Restore button (with `commitHash`) and the chat Undo button (with or
 * without — see `useUndoAction`).
 *
 * Invalidates git-history (a stash and/or restore commit may have landed)
 * user-action notice is returned in `notice` so callers can mirror it into
 * the local transcript store; this hook does not touch the conversation
 * store itself.
 */
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
      // Always invalidate both caches: a stash entry is a commit (history may
      // have shifted), and the working tree is now clean (status changed).
      await queryClient.invalidateQueries({
        queryKey: ['git-history', variables.appId],
        refetchType: 'active',
      });

      // Working tree was rewritten on disk without going through the agent's
      // tool-call path, so neither the cached file tree nor any file already
      // open in the editor reflects what's actually on disk. Force a tree
      // re-fetch and bump the restore signal — PreviewCode subscribes to it
      // and routes its open files through the standard conflict-banner path
      // so the user can choose Reload or Keep my changes per file.
      void useFileTreeStore.getState().loadFiles(variables.appId);
      useCodeSyncStore.getState().signalRestore();
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
