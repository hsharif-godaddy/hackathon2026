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
  hasError?: boolean;
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
  if (options?.hasError) return false;
  const isTerminal =
    data?.status === 'SUCCESS' ||
    data?.status === 'FAILED' ||
    data?.overallStatus === 'SUCCESS' ||
    data?.overallStatus === 'FAILED' ||
    data?.overallStatus === 'NOT_FOUND';
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

/** One step in the ordered connection progress list exposed to UI consumers. */
export type ParsedJobStep = {
  /** i18n message id for the step label (e.g. `builder_domain_job_configuring_dns`) */
  label: string;
  /** Step execution status from the API (e.g. `SUCCESS`, `RUNNING`, `FAILED`) or null if not yet started */
  status: string | null;
};

export interface DomainJobPollPayload {
  /** i18n id read from API `current.label` (or `dynamic.current.label`) — exposed as `labelKey` for the UI */
  labelKey: string | null;
  /** Step status from `current.status` when present */
  status: string | null;
  /** Job-wide status from `overallStatus`; used when `current` is absent or for terminal detection */
  overallStatus: string | null;
  /** Ordered list of all job steps with their per-step status; empty when the API does not return step data */
  steps: ParsedJobStep[];
}

export interface DomainJobPollResult extends DomainJobPollPayload {
  isLoading: boolean;
  /** True during any active network request, including automatic re-polls and manual invalidations */
  isFetching: boolean;
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
    steps?: unknown[];
    stepDefinitions?: unknown[];
  };
  steps?: unknown[];
  stepDefinitions?: unknown[];
  code?: string;
}

// Canonical display order — backend returns configuring_dns before verifying_domain
// but verifying_domain executes first; sort to match actual execution sequence.
const CANONICAL_STEP_ORDER: readonly string[] = [
  'builder_domain_job_starting_connection',
  'builder_domain_job_verifying_domain',
  'builder_domain_job_configuring_dns',
  'builder_domain_job_waiting_for_dns',
  'builder_domain_job_connecting_domain',
  'builder_domain_job_checking_propagation',
  'builder_domain_job_connected',
];

function parseSteps(body: JobApiBody): ParsedJobStep[] {
  // Prefer dynamic.steps (complete ordered list with per-step status from mgmt-airo)
  const rawSteps: unknown[] = Array.isArray(body.dynamic?.steps)
    ? (body.dynamic.steps as unknown[])
    : Array.isArray(body.steps)
      ? body.steps
      : [];
  const parsed: ParsedJobStep[] = rawSteps
    .map((s): ParsedJobStep | null => {
      const step = s as JobStep;
      if (typeof step.label !== 'string' || !step.label.trim()) return null;
      return {
        label: step.label.trim(),
        status: typeof step.status === 'string' && step.status ? step.status : null,
      };
    })
    .filter((s): s is ParsedJobStep => s !== null);

  // Always show all canonical steps — add any missing ones as null-status so the full
  // progress roadmap is visible from the start even before the API reports them.
  const seenLabels: Set<string> = new Set(parsed.map((s: ParsedJobStep) => s.label));
  const withCanonical: ParsedJobStep[] = [
    ...parsed,
    ...CANONICAL_STEP_ORDER
      .filter((label: string) => !seenLabels.has(label))
      .map((label: string): ParsedJobStep => ({ label, status: null })),
  ];

  return withCanonical.sort((a: ParsedJobStep, b: ParsedJobStep) => {
    const ai: number = CANONICAL_STEP_ORDER.indexOf(a.label);
    const bi: number = CANONICAL_STEP_ORDER.indexOf(b.label);
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
  });
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
    steps: parseSteps(body),
  };
}

// BFF proxies management; `current` may be top-level or under `dynamic`; `label` carries the i18n id for the step.
async function fetchDomainJob(siteId: string, fqdn: string): Promise<DomainJobPollPayload> {
  const path = `/api/sites/${encodeURIComponent(siteId)}/domains/job?fqdn=${encodeURIComponent(fqdn.trim())}`;
  const response = await fetch(path, {
    cache: 'no-store',
  });
  if (response.status === 404) {
    const body = await response.json().catch(() => ({})) as JobApiBody;
    if (body?.code === 'SITE_NOT_FOUND') {
      throw new Error(`Failed to fetch domain job: site not found for ${siteId}`);
    }
    return { labelKey: null, status: null, overallStatus: 'NOT_FOUND', steps: [] };
  }
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
  onPollTimeout?: (elapsedMs: number) => void,
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
          hasError: q.state.status === 'error',
          maxPollDurationMs: MAX_POLL_DURATION_MS,
          onPollTimeout: (elapsed) => {
            logger.warn('domain-job-poll.timeout', {
              siteId,
              fqdn: normalizedFqdn,
              elapsed,
            });
            onPollTimeout?.(elapsed);
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
  const steps = query.data?.steps ?? [];

  return {
    labelKey,
    status,
    overallStatus,
    steps,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error : null,
  };
}
