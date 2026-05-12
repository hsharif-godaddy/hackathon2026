import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ImageStatusResponse } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import type { UseAppArchiveRestoreReturn } from './useAppArchiveRestore';
import type { UseAppHibernationReturn } from './useAppHibernation';
import { useSwitchboard } from './useSwitchboard';

const IMAGE_POLL_INTERVAL_MS = 5000;
const IMAGE_RELOAD_TIMEOUT_MS = 90_000;
const SERVER_HEALTH_TIMEOUT_MS = 3 * 60 * 1000;
// Sized to match IMAGE_RELOAD_TIMEOUT_MS so the count-based gave-up fallback
// (used when the user opens the develop page mid-reload) covers the same
// ~90s window as the time-based timed-out fallback. A smaller value would
// fire while the container cutover (30-90s) might still be in progress and
// start server polling against the OLD container — defeating this PR's
// main intent. See PR for the cutover-window analysis.
const RELOADING_MAX_POLLS = Math.ceil(IMAGE_RELOAD_TIMEOUT_MS / IMAGE_POLL_INTERVAL_MS);

export interface UseImageReadinessReturn {
  isChecking: boolean;
  isImageUpdating: boolean;
  isReady: boolean;
  error: string | null;
  retry: () => void;
}

const IMAGES_READY: UseImageReadinessReturn = {
  isChecking: false,
  isImageUpdating: false,
  isReady: true,
  error: null,
  retry: () => {},
};

type Phase =
  | 'idle'
  | 'checking'
  | 'reloading'
  | 'polling-images'
  | 'waiting-server'
  | 'complete'
  | 'short-circuited'
  | 'error';

async function fetchImageStatus(appId: string): Promise<ImageStatusResponse> {
  const response = await appFetch(`/api/sites/${appId}/image-status`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Image status check failed: ${response.status}`);
  }
  return response.json();
}

async function triggerReload(appId: string): Promise<void> {
  const response = await appFetch(
    `/api/sites/${appId}/reload-images`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Reload failed: ${response.status}`);
  }
}

/**
 * Checks image status after hibernation resolves, triggers reload if stale,
 * polls until current, and gates the develop page until images are ready.
 *
 * Follows graceful degradation: only server health timeout is a fatal error.
 */
export function useImageReadiness(
  hibernation: UseAppHibernationReturn,
  appId: string | null,
  isCreateFlow = false,
  archiveRestore?: UseAppArchiveRestoreReturn
): UseImageReadinessReturn {
  const isFeatureEnabled = useSwitchboard('app-builder-app-on-demand-reload');
  const archiveBlocksReady =
    archiveRestore &&
    !archiveRestore.archiveRestoreFailed &&
    (archiveRestore.archiveGatePending ||
      archiveRestore.isArchivedForRestore ||
      archiveRestore.isRestoringFromArchive);
  const canProceed =
    isFeatureEnabled === true &&
    !isCreateFlow &&
    !hibernation.isHibernated &&
    !hibernation.isResuming &&
    !hibernation.resumeFailed &&
    !archiveBlocksReady;

  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer);
  const serverState = useServerPollingStore((state) =>
    appId ? state.servers.get(appId)?.server : null
  );
  const isServerReady = serverState?.isReady ?? false;

  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const hasStartedRef = useRef(false);
  const reloadStartTimeRef = useRef<number | null>(null);
  const serverWaitStartTimeRef = useRef<number | null>(null);
  const reloadingPollCountRef = useRef(0);
  const hasHandledCompletionRef = useRef(false);

  const isReloadingInitialRef = useRef(false);

  // Status check mutation — fires once when canProceed becomes true
  const statusCheck = useMutation({
    mutationFn: () => {
      if (!appId) throw new Error('No app ID');
      logger.info('image-readiness.status-check.start', { appId });
      return fetchImageStatus(appId);
    },
    onSuccess: (data) => {
      logger.info('image-readiness.status-check.result', { appId, status: data.status });

      if (data.status === 'current' || data.status === 'unknown' || data.status === 'unavailable') {
        logger.info('image-readiness.short-circuit', { appId, status: data.status });
        setPhase('short-circuited');
        return;
      }

      if (data.status === 'reloading') {
        // NOTE: Do NOT start server polling here. During the reload window,
        // two containers may serve simultaneously (the OLD one being torn
        // down, the NEW one starting up). Bootstrapping during this window
        // can hit the OLD container's binary, which may lack newer cookie-
        // setting code. Polling is started later, when image-status flips
        // to 'current' (in the poll-result effect below).
        isReloadingInitialRef.current = true;
        reloadingPollCountRef.current = 0;
        // Anchor the time-based timed-out budget to "now" — without this,
        // reloadStartTimeRef stays null for the user-opens-page-mid-reload
        // path, leaving only the count-based gave-up as the escape. With
        // it set, both budgets fire at ~IMAGE_RELOAD_TIMEOUT_MS, giving
        // belt-and-suspenders for the cutover window.
        reloadStartTimeRef.current = Date.now();
        setPhase('polling-images');
        return;
      }

      if (data.status === 'stale') {
        isReloadingInitialRef.current = false;
        setPhase('reloading');
      }
    },
    onError: (err) => {
      logger.error('image-readiness.status-check.failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      logger.info('image-readiness.short-circuit', { appId, reason: 'status-check-failed' });
      setPhase('short-circuited');
    },
  });

  // Reload mutation — fires when status is 'stale'
  const reload = useMutation({
    mutationFn: () => {
      if (!appId) throw new Error('No app ID');
      logger.info('image-readiness.reload.start', { appId });
      return triggerReload(appId);
    },
    onSuccess: () => {
      // NOTE: Do NOT start server polling here. The container is mid-cutover
      // (old container being torn down, new container starting). Polling
      // bootstraps during this window can hit the OLD container's binary
      // and miss the cookie-setting code path. Polling fires later, when
      // image-status flips to 'current' in the poll-result effect below.
      reloadStartTimeRef.current = Date.now();
      reloadingPollCountRef.current = 0;
      setPhase('polling-images');
    },
    onError: (err) => {
      logger.error('image-readiness.reload.failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Reload trigger failed but the container may still come up via
      // other means (manual deploy, retry). Start polling now as a fallback
      // — at this point we've already given up on the orchestrated reload,
      // so cutover-window risk no longer applies.
      if (appId) startPollingForServer(appId);
      logger.info('image-readiness.server-wait.start', { appId, reason: 'reload-failed' });
      serverWaitStartTimeRef.current = Date.now();
      setPhase('waiting-server');
    },
  });

  // Trigger reload when phase becomes 'reloading'
  useEffect(() => {
    if (phase !== 'reloading' || reload.isPending) return;
    reload.mutate();
  }, [phase, reload]);

  const shouldPollImages = phase === 'polling-images';

  type PollAction = 'gave-up' | 'timed-out' | 'current' | 'polling' | 'poll-error';

  const poll = useQuery({
    queryKey: ['image-status-poll', appId],
    queryFn: async (): Promise<{ action: PollAction } | null> => {
      if (!appId) return null;

      if (isReloadingInitialRef.current) {
        reloadingPollCountRef.current++;
        if (reloadingPollCountRef.current > RELOADING_MAX_POLLS) {
          return { action: 'gave-up' };
        }
      }

      if (reloadStartTimeRef.current && Date.now() - reloadStartTimeRef.current > IMAGE_RELOAD_TIMEOUT_MS) {
        return { action: 'timed-out' };
      }

      try {
        const result = await fetchImageStatus(appId);
        return { action: result.status === 'current' ? 'current' : 'polling' };
      } catch {
        return { action: 'poll-error' };
      }
    },
    enabled: shouldPollImages,
    refetchInterval: shouldPollImages ? IMAGE_POLL_INTERVAL_MS : false,
    staleTime: 0,
  });

  // React to poll results — state transitions happen here, not inside queryFn.
  // `serverWaitStartTimeRef` uses `??` to preserve any timestamp already set earlier
  // in the polling-images phase, consistent with the `action === 'current'` case.
  //
  // Server polling is started HERE (not earlier in the lifecycle) — this is the
  // first point at which image-status has either confirmed 'current' or we've
  // given up waiting. Starting earlier would race the container cutover and
  // bootstrap against the OLD container, which may lack the cookie-setting
  // code path that the NEW container has. See plan doc for full context.
  //
  // All terminal actions (`gave-up` | `timed-out` | `current`) start polling and
  // transition to `waiting-server`. The `poll-error` case stays in
  // `polling-images` and waits for the next poll tick — this is bounded by:
  //   - `isReloadingInitialRef` path: `gave-up` after RELOADING_MAX_POLLS (~15s)
  //   - `stale → reload` path: `timed-out` after IMAGE_RELOAD_TIMEOUT_MS (90s)
  // So repeated poll errors can't hold the user indefinitely.
  useEffect(() => {
    if (phase !== 'polling-images' || !poll.data) return;

    const { action } = poll.data;

    // Non-terminal: stay in polling-images and wait for the next refetch tick.
    // Bounded by the gave-up/timed-out budgets above.
    if (action === 'polling') return;
    if (action === 'poll-error') {
      logger.warn('image-readiness.poll.error', { appId });
      return;
    }

    // Terminal actions — log per-action context, then start polling and
    // transition to waiting-server uniformly.
    if (action === 'gave-up') {
      logger.warn('image-readiness.reloading.gave-up', { appId, polls: reloadingPollCountRef.current });
      logger.info('image-readiness.server-wait.start', { appId, reason: 'reloading-polls-exhausted' });
    } else if (action === 'timed-out') {
      logger.warn('image-readiness.reload.timeout', { appId });
      logger.info('image-readiness.server-wait.start', { appId, reason: 'reload-timeout' });
    }
    // `action === 'current'`: image-status confirms cutover is complete. Safe
    // to bootstrap now — the request will land on the new container with the
    // correct binary. (No log: this is the happy path.)

    serverWaitStartTimeRef.current = serverWaitStartTimeRef.current ?? Date.now();
    if (appId) startPollingForServer(appId);
    setPhase('waiting-server');
  }, [phase, poll.data, appId, startPollingForServer]);

  // Server health timeout check
  useEffect(() => {
    if (phase !== 'waiting-server') return;

    if (isServerReady) return;

    if (!serverWaitStartTimeRef.current) {
      serverWaitStartTimeRef.current = Date.now();
    }

    const interval = setInterval(() => {
      if (serverWaitStartTimeRef.current && Date.now() - serverWaitStartTimeRef.current > SERVER_HEALTH_TIMEOUT_MS) {
        logger.error('image-readiness.server-wait.timeout', { appId });
        setError('Server failed to become healthy after image update');
        setPhase('error');
        clearInterval(interval);
      }
    }, IMAGE_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [phase, appId, isServerReady]);

  // Completion: server is ready while waiting
  useEffect(() => {
    if (phase !== 'waiting-server' || !isServerReady || !appId) return;
    if (hasHandledCompletionRef.current) return;

    hasHandledCompletionRef.current = true;
    logger.info('image-readiness.complete', { appId });

    queryClient.invalidateQueries({ queryKey: ['app-details', appId] });
    queryClient.invalidateQueries({ queryKey: ['git-history', appId] });
    queryClient.invalidateQueries({ queryKey: ['deployments', appId] });

    setPhase('complete');
  }, [phase, isServerReady, appId, queryClient]);

  // Trigger status check when canProceed becomes true
  useEffect(() => {
    if (!canProceed || !appId || hasStartedRef.current) return;
    hasStartedRef.current = true;
    setPhase('checking');
    statusCheck.mutate();
  }, [canProceed, appId, statusCheck]);

  // Reset on app change
  useEffect(() => {
    return () => {
      hasStartedRef.current = false;
      hasHandledCompletionRef.current = false;
      isReloadingInitialRef.current = false;
      reloadStartTimeRef.current = null;
      serverWaitStartTimeRef.current = null;
      reloadingPollCountRef.current = 0;
      setPhase('idle');
      setError(null);
    };
  }, [appId]);

  // Resetting hasStartedRef allows the canProceed effect (line ~260) to
  // re-fire statusCheck.mutate() on the next render, restarting the flow.
  const retry = useCallback(() => {
    hasStartedRef.current = false;
    hasHandledCompletionRef.current = false;
    isReloadingInitialRef.current = false;
    reloadStartTimeRef.current = null;
    serverWaitStartTimeRef.current = null;
    reloadingPollCountRef.current = 0;
    setPhase('idle');
    setError(null);
    statusCheck.reset();
    reload.reset();
    queryClient.removeQueries({ queryKey: ['image-status-poll', appId] });
  }, [statusCheck, reload, queryClient, appId]);

  // Resume failed is handled by the hibernation layer; don't block
  if (hibernation.resumeFailed) {
    return IMAGES_READY;
  }

  if (archiveRestore?.archiveRestoreFailed) {
    return IMAGES_READY;
  }

  // Newly created apps already have the latest image; skip all status checks.
  if (isCreateFlow) {
    return IMAGES_READY;
  }

  if (!isFeatureEnabled) {
    return IMAGES_READY;
  }

  // Both idle and checking show the lightweight CHECKING_IMAGES loader.
  // This causes a brief flash on every page load before the status API responds,
  // even when images are already current — this is intentional to gate rendering
  // until we've confirmed image freshness.
  if (phase === 'idle' || phase === 'checking') {
    return { isChecking: true, isImageUpdating: false, isReady: false, error: null, retry };
  }

  if (phase === 'short-circuited' || phase === 'complete') {
    return IMAGES_READY;
  }

  if (phase === 'error') {
    return { isChecking: false, isImageUpdating: false, isReady: false, error, retry };
  }

  return { isChecking: false, isImageUpdating: true, isReady: false, error: null, retry };
}
