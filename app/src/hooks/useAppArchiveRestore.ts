import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMachine } from '@xstate/react';

import { appFetch, AuthDismissedError, AuthSessionExpiredError } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { archiveRestoreMachine } from './archiveRestoreMachine';

const ARCHIVE_STATUS_POLL_MS = 5000;

export interface UseAppArchiveRestoreReturn {
  /** True until the first archive-status response when the hook is enabled (avoid racing hibernation resume). */
  archiveGatePending: boolean;
  isArchivedForRestore: boolean;
  isRestoringFromArchive: boolean;
  archiveRestoreFailed: boolean;
  archiveRestoreComplete: boolean;
  restoreFromArchive: () => void;
  error: string | null;
}

interface ArchiveStatusResponse {
  isArchived: boolean;
  canRestore: boolean;
  status?: string;
  inProgress?: boolean;
  archiveId?: number;
  backupId?: string;
  backupRegion?: string;
  originalCellId?: string;
  originalDatabaseId?: string;
  originalFilesystemId?: string;
  archiveRequestedAt?: string;
  archivedAt?: string;
}

async function fetchArchiveStatus(appId: string): Promise<ArchiveStatusResponse> {
  const response = await appFetch(`/api/sites/${appId}/archive-status`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Archive status check failed: ${response.status}`);
  }
  return response.json();
}

async function postArchiveRestore(appId: string): Promise<{ statusJobId: string }> {
  const response = await appFetch(`/api/sites/${appId}/archive-restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, { authLevel: 3 });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // Preflight timeout / re-auth failure: { authReason: 2 } with no `error`
    // field. Throw typed so onError can skip the failed-state dispatch.
    if (response.status === 401) {
      throw new AuthSessionExpiredError();
    }
    throw new Error(data.error || `Archive restore failed: ${response.status}`);
  }
  return response.json();
}

const NOT_ARCHIVED: UseAppArchiveRestoreReturn = {
  archiveGatePending: false,
  isArchivedForRestore: false,
  isRestoringFromArchive: false,
  archiveRestoreFailed: false,
  archiveRestoreComplete: false,
  restoreFromArchive: () => {},
  error: null,
};

/**
 * Cold-archive restore: separate from hibernation resume.
 *
 * Scope: drive archive-status from "archived" -> "restored" via POST /archive-restore and polling.
 *
 * Trigger model: the /archive-status endpoint is the authoritative signal. When
 * `isArchived && canRestore` is true, the app is cold-archived and restore is an
 * allowed action for this user; mgmt-airo enforces any compliance/admin gating
 * on its side by returning `canRestore: false`. There is no client-side reason
 * gate — once archiving has finished, `lifecycle.reason` should not be treated
 * as preserving the original archive cause.
 *
 * Precedence: develop page suppresses hibernation while archive flow is active
 * (see suppressHibernationForArchive) so we never race /resume against /archive-restore.
 *
 * State is managed by an XState machine (archiveRestoreMachine). The hook's job is:
 * 1. Sync react-query results into machine events (STATUS_*, RESTORE_*)
 * 2. Fire the mutation when the machine enters `restoring.triggering`
 * 3. Run completion side effects (query invalidation) when entering `complete`
 */
export function useAppArchiveRestore(
  appId: string | null | undefined,
  enabled: boolean,
  autoRestore = false
): UseAppArchiveRestoreReturn {
  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer);
  const queryClient = useQueryClient();

  const [state, send] = useMachine(archiveRestoreMachine, {
    input: {
      appId: appId ?? null,
      autoRestore,
    },
  });

  const isActive = enabled && !!appId;

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  const restoreMutation = useMutation({
    mutationFn: () => {
      if (!appId) throw new Error('No app ID');
      return postArchiveRestore(appId);
    },
    onSuccess: (data) => {
      if (appId) {
        startPollingForServer(appId);
        queryClient.invalidateQueries({ queryKey: ['archive-status', appId] });
      }
      send({ type: 'RESTORE_SUCCEEDED', jobId: data.statusJobId });
    },
    onError: (error) => {
      // Auth-related failures (user dismissed re-auth, modal timeout, 401) are
      // not restore failures. RESTORE_CANCELLED returns the machine to
      // needsRestore with autoRestore cleared via the machine's disableAutoRestore
      // action, so the `needsRestore.always` transition does not immediately
      // re-fire and reopen the SSO modal in a loop.
      if (error instanceof AuthDismissedError || error instanceof AuthSessionExpiredError) {
        send({ type: 'RESTORE_CANCELLED' });
        return;
      }
      send({
        type: 'RESTORE_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // -------------------------------------------------------------------------
  // Query (archive-status)
  // -------------------------------------------------------------------------

  // Poll while we actively care about status flipping (during restore wait and while needsRestore).
  // Single-fetch otherwise. Mutation in flight suppresses polling.
  const shouldPoll =
    state.matches('needsRestore') || state.matches({ restoring: 'waitingForStatus' });

  const archiveStatusQuery = useQuery({
    queryKey: ['archive-status', appId],
    queryFn: () => fetchArchiveStatus(appId!),
    enabled: isActive,
    staleTime: 0,
    refetchInterval: () => {
      if (restoreMutation.isPending) return false;
      return shouldPoll ? ARCHIVE_STATUS_POLL_MS : false;
    },
  });

  // -------------------------------------------------------------------------
  // Drive machine from external sources
  // -------------------------------------------------------------------------

  // START / RESET based on enabled + appId changes
  useEffect(() => {
    if (!isActive) {
      if (!state.matches('idle')) {
        send({ type: 'RESET' });
      }
      return;
    }
    if (state.matches('idle')) {
      send({ type: 'START', appId: appId!, autoRestore });
      return;
    }
    if (state.context.appId && state.context.appId !== appId) {
      send({ type: 'RESET' });
    }
  }, [isActive, appId, autoRestore, state, send]);

  // Translate query data/errors into machine events
  useEffect(() => {
    if (!isActive) return;

    if (archiveStatusQuery.isSuccess) {
      const data = archiveStatusQuery.data;
      const needsRestore = Boolean(data?.isArchived && data?.canRestore);

      if (state.matches('checkingStatus')) {
        send({ type: needsRestore ? 'STATUS_NEEDS_RESTORE' : 'STATUS_NOT_ARCHIVED' });
      } else if (state.matches({ restoring: 'waitingForStatus' }) && !needsRestore) {
        send({ type: 'STATUS_RESTORED' });
      } else if (state.matches('needsRestore') && !needsRestore) {
        // canRestore retracted (compliance hold / admin action) while the user is
        // on the restore screen. Log for observability, then exit via STATUS_NOT_ARCHIVED
        // so the machine transitions to notArchived rather than leaving the user stuck
        // indefinitely with a non-functional Restore button.
        logger.warn('archive.status.unexpectedNotArchived', {
          appId,
          machineState: JSON.stringify(state.value),
          isArchived: data?.isArchived,
          canRestore: data?.canRestore,
        });
        send({ type: 'STATUS_NOT_ARCHIVED' });
      }
      return;
    }

    if (archiveStatusQuery.isError) {
      // Initial fetch error: be graceful (treat as not-archived) rather than failing the page.
      // Errors during restore wait are surfaced as failures.
      const err = archiveStatusQuery.error;
      const message = err instanceof Error ? err.message : err ? String(err) : 'archive-status error';
      if (state.matches('checkingStatus')) {
        logger.warn('archive.status.initialCheckFailed', { appId, error: message });
        send({ type: 'STATUS_NOT_ARCHIVED' });
      } else if (state.matches({ restoring: 'waitingForStatus' })) {
        send({ type: 'STATUS_ERROR', error: message });
      } else {
        // Poll error in needsRestore (or any other non-actionable state): no machine transition,
        // but log so the failure is observable in production.
        logger.warn('archive.status.unexpectedError', { appId, machineState: JSON.stringify(state.value), error: message });
      }
    }
  }, [
    isActive,
    archiveStatusQuery.isSuccess,
    archiveStatusQuery.isError,
    archiveStatusQuery.data,
    archiveStatusQuery.error,
    state,
    send,
  ]);

  // Fire the mutation whenever the machine sits in `restoring.triggering`.
  // Dedupe via mutation.isIdle: after mutate() it becomes pending/success/error.
  // Callers wanting a retry call restoreMutation.reset() first.
  const isTriggering = state.matches({ restoring: 'triggering' });
  const { isIdle: isMutationIdle, mutate: triggerMutation } = restoreMutation;
  useEffect(() => {
    if (isTriggering && isMutationIdle) {
      triggerMutation();
    }
  }, [isTriggering, isMutationIdle, triggerMutation]);

  // Completion side effects: invalidate downstream caches
  const isComplete = state.matches('complete');
  useEffect(() => {
    if (!isComplete || !appId) return;
    queryClient.invalidateQueries({ queryKey: ['app-details', appId] });
    queryClient.invalidateQueries({ queryKey: ['archive-status', appId] });
    queryClient.invalidateQueries({ queryKey: ['git-history', appId] });
    queryClient.invalidateQueries({ queryKey: ['deployments', appId] });
  }, [isComplete, appId, queryClient]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  if (!enabled) {
    return NOT_ARCHIVED;
  }

  return {
    archiveGatePending: isActive && !archiveStatusQuery.isFetched,
    isArchivedForRestore: state.matches('needsRestore'),
    isRestoringFromArchive: state.matches('restoring'),
    archiveRestoreFailed: state.matches('failed'),
    archiveRestoreComplete: state.matches('complete'),
    restoreFromArchive: () => {
      restoreMutation.reset();
      if (appId) {
        queryClient.resetQueries({ queryKey: ['archive-status', appId] });
      }
      send({ type: 'TRIGGER_RESTORE' });
    },
    error: state.context.error,
  };
}
