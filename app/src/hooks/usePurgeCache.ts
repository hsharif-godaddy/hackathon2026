import { useCallback, useEffect, useRef, useState } from 'react';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

export enum PurgeStatus {
  IDLE = 'idle',
  STARTING = 'starting',
  POLLING = 'polling',
  SUCCESS = 'success',
  FAILURE = 'failure',
  ERROR = 'error',
}

export enum PurgeErrorCode {
  TIMEOUT = 'timeout',
  POLL_FAILED = 'poll_failed',
  JOB_FAILED = 'job_failed',
  NETWORK = 'network',
  TRIGGER_FAILED = 'trigger_failed',
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000;

interface UsePurgeCacheResult {
  trigger: () => Promise<void>;
  status: PurgeStatus;
  errorCode: PurgeErrorCode | null;
}

export function usePurgeCache(appId: string | null): UsePurgeCacheResult {
  const [status, setStatus] = useState<PurgeStatus>(PurgeStatus.IDLE);
  const [errorCode, setErrorCode] = useState<PurgeErrorCode | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const pollStartRef = useRef<number>(0);

  const cleanup = useCallback(function cleanup() {
    cancelledRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const poll = useCallback(async function poll(jobId: string) {
    if (cancelledRef.current) return;

    if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
      setStatus(PurgeStatus.ERROR);
      setErrorCode(PurgeErrorCode.TIMEOUT);
      return;
    }

    try {
      const response = await appFetch(`/api/jobs/${jobId}`);

      if (!response.ok) {
        setStatus(PurgeStatus.ERROR);
        setErrorCode(PurgeErrorCode.POLL_FAILED);
        return;
      }

      const job = await response.json();

      if (job.status === 'success') {
        setStatus(PurgeStatus.SUCCESS);
        return;
      }

      if (job.status === 'failure') {
        setStatus(PurgeStatus.FAILURE);
        setErrorCode(PurgeErrorCode.JOB_FAILED);
        return;
      }

      if (!cancelledRef.current) {
        timerRef.current = setTimeout(() => poll(jobId), POLL_INTERVAL_MS);
      }
    } catch {
      if (!cancelledRef.current) {
        setStatus(PurgeStatus.ERROR);
        setErrorCode(PurgeErrorCode.NETWORK);
      }
    }
  }, []);

  const trigger = useCallback(async function trigger() {
    if (!appId) return;

    cancelledRef.current = false;
    setStatus(PurgeStatus.STARTING);
    setErrorCode(null);

    try {
      const response = await appFetch(`/api/apps/${appId}/purge-cache`, {
        method: 'POST',
      });

      if (!response.ok) {
        setStatus(PurgeStatus.ERROR);
        setErrorCode(PurgeErrorCode.TRIGGER_FAILED);
        return;
      }

      const { jobId } = await response.json();

      logger.info('purge-cache.polling.start', { appId, jobId });

      setStatus(PurgeStatus.POLLING);
      pollStartRef.current = Date.now();
      poll(jobId);
    } catch (err) {
      logger.error('purge-cache.trigger.error', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      setStatus(PurgeStatus.ERROR);
      setErrorCode(PurgeErrorCode.TRIGGER_FAILED);
    }
  }, [appId, poll]);

  return { trigger, status, errorCode };
}
