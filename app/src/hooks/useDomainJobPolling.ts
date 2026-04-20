import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';

const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 30_000;
/** After this elapsed time from first poll, use SLOW_POLL_MS while still RUNNING */
const BACKOFF_AFTER_MS = 60_000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000;

export type DomainJobPollIntervalOptions = {
  maxPollDurationMs?: number;
  onPollTimeout?: (elapsedMs: number) => void;
};

/**
 * Pure refetch interval for domain-job polling (exposed for unit tests).
 * Stops on known terminal step/job statuses, optional max session duration, then backoff.
 */
export function getDomainJobPollRefetchInterval(
  enabled: boolean,
  data: DomainJobPollPayload | undefined,
  pollStartedAt: number | null,
  nowMs: number,
  options?: DomainJobPollIntervalOptions,
): number | false {
  if (!enabled) return false;
  const isTerminal =
    data?.status === 'SUCCESS' ||
    data?.status === 'FAILED' ||
    data?.overallStatus === 'SUCCESS' ||
    data?.overallStatus === 'FAILED';
  if (isTerminal) return false;
  if (
    options?.maxPollDurationMs != null &&
    pollStartedAt != null
  ) {
    const elapsed = nowMs - pollStartedAt;
    if (elapsed >= options.maxPollDurationMs) {
      options.onPollTimeout?.(elapsed);
      return false;
    }
  }
  if (!pollStartedAt) return FAST_POLL_MS;
  const elapsed = nowMs - pollStartedAt;
  return elapsed < BACKOFF_AFTER_MS ? FAST_POLL_MS : SLOW_POLL_MS;
}
/** Keep finished job payload around for UI after store clears the in-progress job */
const CACHE_GC_MS = 10 * 60_000;

export type JobStep = {
  id?: string;
  /**
   * Backend field name; value is an i18n message id (e.g. `builder_domain_job_configuring_dns`), not user-facing copy.
   */
  label?: string;
  status?: string;
};

export interface DomainJobPollPayload {
  /** i18n id read from API `current.label` (or `dynamic.current.label`) — exposed as `labelKey` for the UI */
  labelKey: string | null;
  /** Step status from `current.status` when present */
  status: string | null;
  /** Job-wide status from `overallStatus`; used when `current` is absent or for terminal detection */
  overallStatus: string | null;
}

export interface DomainJobPollResult extends DomainJobPollPayload {
  isLoading: boolean;
  error: Error | null;
}

export function domainJobQueryKey(siteId: string, fqdn: string) {
  return ['domain-job', siteId, fqdn.trim().toLowerCase()] as const;
}

/** GET …/domains/job?fqdn= — airo-modify-domains job payload from management / BFF */
interface JobApiBody {
  id?: string;
  type?: string;
  overallStatus?: string;
  current?: JobStep | null;
  dynamic?: {
    current?: JobStep | null;
  };
  steps?: unknown[];
  stepDefinitions?: unknown[];
}

export function parseJobResponse(json: unknown): DomainJobPollPayload {
  const body = json as JobApiBody;
  const cur = body.dynamic?.current ?? body.current;
  // Backend returns the translation key in `label` (e.g. `builder_domain_job_configuring_dns`).
  const rawKey = cur && typeof cur.label === 'string' ? cur.label.trim() : '';
  const labelKey = rawKey.length > 0 ? rawKey : null;
  const overallStatus =
    typeof body?.overallStatus === 'string' ? body.overallStatus : null;
  return {
    labelKey,
    status: typeof cur?.status === 'string' ? cur.status : null,
    overallStatus,
  };
}

// BFF proxies management; `current` may be top-level or under `dynamic`; `label` carries the i18n id for the step.
async function fetchDomainJob(siteId: string, fqdn: string): Promise<DomainJobPollPayload> {
  const path = `/api/sites/${encodeURIComponent(siteId)}/domains/job?fqdn=${encodeURIComponent(fqdn.trim())}`;
  const response = await fetch(path, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch domain job: ${response.status} ${response.statusText}`);
  }
  return parseJobResponse(await response.json());
}

/**
 * Polls airo-modify-domains job status via GET /api/sites/{siteId}/domains/job?fqdn=…
 * Maps API `current.label` (translation key) to result `labelKey`; includes `status` and `overallStatus`.
 * Pass `enabled` when the UI tracks an in-progress domain job; cache key stays stable so SUCCESS remains after the store clears.
 */
export function useDomainJobPolling(
  siteId: string,
  fqdn: string,
  enabled: boolean,
): DomainJobPollResult {
  const startTimeRef = useRef<number | null>(null);
  const normalizedFqdn = fqdn.trim();

  useEffect(() => {
    if (!enabled) {
      startTimeRef.current = null;
      return;
    }
    startTimeRef.current = Date.now();
  }, [enabled]);

  const query = useQuery({
    queryKey: domainJobQueryKey(siteId, normalizedFqdn),
    queryFn: async () => fetchDomainJob(siteId, normalizedFqdn),
    enabled: enabled && Boolean(siteId && normalizedFqdn),
    gcTime: CACHE_GC_MS,
    refetchInterval: (q) => {
      const now = Date.now();
      return getDomainJobPollRefetchInterval(
        enabled,
        q.state.data,
        startTimeRef.current,
        now,
        {
          maxPollDurationMs: MAX_POLL_DURATION_MS,
          onPollTimeout: (elapsed) => {
            logger.warn('domain-job-poll.timeout', {
              siteId,
              fqdn: normalizedFqdn,
              elapsed,
            });
          },
        },
      );
    },
    refetchOnWindowFocus: enabled,
    staleTime: enabled ? 0 : Number.POSITIVE_INFINITY,
  });

  const labelKey = query.data?.labelKey ?? null;
  const status = query.data?.status ?? null;
  const overallStatus = query.data?.overallStatus ?? null;

  return {
    labelKey,
    status,
    overallStatus,
    isLoading: query.isPending,
    error: query.error instanceof Error ? query.error : null,
  };
}
