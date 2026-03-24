import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { LifecycleReason, LifecycleState, type SiteVariant } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { AppDetailsResponse } from './useAppDetails';

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 3 * 60 * 1000;

export interface UseAppHibernationReturn {
  isHibernated: boolean;
  isResuming: boolean;
  resumeFailed: boolean;
  resumeComplete: boolean;
  resume: () => void;
  error: string | null;
}

function checkHibernated(appDetails: AppDetailsResponse | null | undefined): boolean {
  const variants = appDetails?.variantsWithLifecycle as SiteVariant[] | undefined;
  if (!variants?.length) return false;

  const preview = variants.find(v => v.variant === 'preview');
  return preview?.lifecycle?.lifecycleState === LifecycleState.PAUSED &&
         preview?.lifecycle?.reason === LifecycleReason.HIBERNATION;
}

function checkRunning(appDetails: AppDetailsResponse | null | undefined): boolean {
  const variants = appDetails?.variantsWithLifecycle as SiteVariant[] | undefined;
  if (!variants?.length) return false;

  const preview = variants.find(v => v.variant === 'preview');
  return preview?.lifecycle?.lifecycleState === LifecycleState.RUNNING;
}

async function resumeApp(appId: string): Promise<void> {
  const response = await appFetch(`/api/sites/${appId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: 'preview' }),
  });

  if (response.status === 409) {
    logger.warn('app-hibernation.resume.concurrent', { appId });
    return;
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Resume failed: ${response.status}`);
  }
}

// Default return for non-hibernated apps (most common case)
const NOT_HIBERNATED: UseAppHibernationReturn = {
  isHibernated: false,
  isResuming: false,
  resumeFailed: false,
  resumeComplete: false,
  resume: () => {},
  error: null,
};

/**
 * Detects hibernation and handles resume with auto-resume support.
 * Short-circuits early for non-hibernated apps (most common case).
 */
export function useAppHibernation(
  appDetails: AppDetailsResponse | null | undefined,
  appId: string | null | undefined,
  autoResume = false
): UseAppHibernationReturn {
  const isHibernated = checkHibernated(appDetails);
  const isRunning = checkRunning(appDetails);

  // Subscribe to server state with a reactive selector
  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer);
  const serverState = useServerPollingStore((state) =>
    appId ? state.servers.get(appId)?.server : null
  );
  const isServerReady = serverState?.isReady ?? false;

  const queryClient = useQueryClient();
  const hasAutoResumedRef = useRef(false);
  const resumeStartTimeRef = useRef<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [resumeComplete, setResumeComplete] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      if (!appId) throw new Error('No app ID');
      return resumeApp(appId);
    },
    retry: 2,
    onSuccess: () => {
      resumeStartTimeRef.current = Date.now();
      setTimedOut(false);
      // Start server polling to detect when server is healthy
      if (appId) {
        startPollingForServer(appId);
      }
    },
    onError: (error) => {
      logger.error('app-hibernation.resume.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // Poll until BOTH lifecycle is RUNNING AND server is ready
  const shouldPoll = mutation.isSuccess && !timedOut && (!isRunning || !isServerReady);

  useQuery({
    queryKey: ['hibernation-poll', appId],
    queryFn: async () => {
      // Check timeout
      if (resumeStartTimeRef.current && Date.now() - resumeStartTimeRef.current > TIMEOUT_MS) {
        logger.warn('app-hibernation.resume.timeout', { appId });
        setTimedOut(true);
        return { timedOut: true };
      }

      // Invalidate app-details to get fresh lifecycle state
      await queryClient.invalidateQueries({ queryKey: ['app-details', appId] });
      return { polledAt: Date.now() };
    },
    enabled: shouldPoll,
    refetchInterval: shouldPoll ? POLL_INTERVAL_MS : false,
    staleTime: 0,
  });

  // Track if we've handled resume completion
  const hasHandledCompletionRef = useRef(false);

  // Resume is complete only when lifecycle is RUNNING AND server is healthy
  useEffect(() => {
    if (!mutation.isSuccess || !isRunning || !isServerReady || !appId) return;
    if (hasHandledCompletionRef.current) return;

    hasHandledCompletionRef.current = true;

    // Set resumeComplete - server is now truly ready
    setResumeComplete(true);

    // Invalidate all queries that need fresh data after resume
    queryClient.invalidateQueries({ queryKey: ['app-details', appId] });
    queryClient.invalidateQueries({ queryKey: ['git-history', appId] });
    queryClient.invalidateQueries({ queryKey: ['deployments', appId] });

    // Reset mutation so the hook returns to normal state
    mutation.reset();
  }, [mutation, isRunning, isServerReady, appId, queryClient]);

  // Auto-resume once
  useEffect(() => {
    if (!isHibernated || !autoResume || !appId) return;
    if (hasAutoResumedRef.current || mutation.isPending) return;

    hasAutoResumedRef.current = true;
    mutation.mutate();
  }, [autoResume, appId, isHibernated, mutation]);

  // Reset on app change
  useEffect(() => {
    return () => {
      hasAutoResumedRef.current = false;
      hasHandledCompletionRef.current = false;
      resumeStartTimeRef.current = null;
      setTimedOut(false);
      setResumeComplete(false);
    };
  }, [appId]);

  // Fast path: not hibernated and no resume in progress
  if (!isHibernated && !mutation.isPending && !mutation.isSuccess && !resumeComplete) {
    return NOT_HIBERNATED;
  }

  // isResuming is true until BOTH lifecycle is running AND server is healthy
  const isResuming = mutation.isPending ||
    (mutation.isSuccess && !timedOut && (!isRunning || !isServerReady));

  return {
    isHibernated,
    isResuming,
    resumeFailed: mutation.isError || timedOut,
    resumeComplete,
    resume: () => mutation.mutate(),
    error: mutation.error?.message ?? null,
  };
}
