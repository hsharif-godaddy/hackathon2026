import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMachine } from '@xstate/react';

import type { AppDetailsResponse } from '@/hooks/useAppDetails';
import { LifecycleReason, type SiteVariant } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
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
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
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
 * Non-scope: mgmt-airo leaves variantsWithLifecycle on its previous state (typically paused/hibernation)
 * after archive restore. The develop page chains useAppHibernation after this hook completes to
 * resume the variant back to RUNNING.
 *
 * Precedence: develop page suppresses hibernation while archive flow is active
 * (see suppressHibernationForArchive).
 *
 * Auto-restore gate: when `autoRestore` is true, we only auto-trigger the restore if the preview
 * variant's lifecycle.reason is "hibernation". The /archive-status endpoint itself does not carry
 * an archive cause, so we read it from appDetails.variantsWithLifecycle. Non-hibernation archives
 * (compliance, admin, etc.) require an explicit user action via `restoreFromArchive()`.
 *
 * State is managed by an XState machine (archiveRestoreMachine) instead of tangled
 * useState/useRef booleans. The hook's job is:
 * 1. Sync react-query results into machine events (STATUS_*, RESTORE_*)
 * 2. Fire the mutation when the machine enters `restoring.triggering`
 * 3. Run completion side effects (query invalidation) when entering `complete`
 */
export function useAppArchiveRestore(
  appDetails: AppDetailsResponse | null | undefined,
  appId: string | null | undefined,
  enabled: boolean,
  autoRestore = false
): UseAppArchiveRestoreReturn {
  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer);
  const queryClient = useQueryClient();

  // Derive the preview variant lifecycle reason. /archive-status does not include an archive
  // cause, so we read it from appDetails. Auto-restore is gated on this so that apps archived
  // for other reasons (compliance, admin, etc.) do not silently restore.
  const previewLifecycleReason = (() => {
    const variants = appDetails?.variantsWithLifecycle as SiteVariant[] | undefined;
    return variants?.find(v => v.variant === 'preview')?.lifecycle?.reason ?? null;
  })();
  const isHibernationArchive = previewLifecycleReason === LifecycleReason.HIBERNATION;
  const effectiveAutoRestore = autoRestore && isHibernationArchive;

  const [state, send] = useMachine(archiveRestoreMachine, {
    input: {
      appId: appId ?? null,
      autoRestore: effectiveAutoRestore,
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
      send({ type: 'START', appId: appId!, autoRestore: effectiveAutoRestore });
      return;
    }
    if (state.context.appId && state.context.appId !== appId) {
      send({ type: 'RESET' });
    }
  }, [isActive, appId, effectiveAutoRestore, state, send]);

  // appDetails arrives async, so the lifecycle reason may not be known when START fires.
  // If we entered `needsRestore` with autoRestore=false because the reason wasn't known yet
  // (or hadn't yet flipped to hibernation), trigger the restore now that the gate passes.
  useEffect(() => {
    if (!isActive) return;
    if (!autoRestore) return;
    if (!isHibernationArchive) return;
    if (!state.matches('needsRestore')) return;
    send({ type: 'TRIGGER_RESTORE' });
  }, [isActive, autoRestore, isHibernationArchive, state, send]);

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
      }
      return;
    }

    if (archiveStatusQuery.isError) {
      // Initial fetch error: be graceful (treat as not-archived) rather than failing the page.
      // Errors during restore wait are surfaced as failures.
      if (state.matches('checkingStatus')) {
        send({ type: 'STATUS_NOT_ARCHIVED' });
      } else if (state.matches({ restoring: 'waitingForStatus' })) {
        const err = archiveStatusQuery.error;
        const message = err instanceof Error ? err.message : err ? String(err) : 'archive-status error';
        send({ type: 'STATUS_ERROR', error: message });
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
