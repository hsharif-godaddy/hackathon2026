import { useRef } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import type { AiroDeployment } from '@/lib/mgmt-airo';
import type { AiroDomain } from '@/lib/mgmt-airo/types';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes max

/**
 * Terminal deployment statuses that indicate polling should stop
 */
const TERMINAL_STATUSES: readonly DeploymentStatus[] = [
  DeploymentStatus.DEPLOYED,
  DeploymentStatus.FAILED,
];

interface UseDeploymentStatusPollingOptions {
  appId: string;
  deploymentId: string | null;
  onComplete?: (status: DeploymentStatus) => void;
}

interface DeploymentToTrack {
  appId: string;
  deploymentId: string;
}

interface UseMultipleDeploymentStatusPollingOptions {
  deployments: DeploymentToTrack[];
  onComplete?: (appId: string, status: DeploymentStatus) => void;
}

/** Query state shape for deployment status polling refetchInterval */
interface DeploymentStatusQueryState {
  state: { data?: { status: DeploymentStatus | null } };
  meta?: { pollingStartedAt?: number | null };
}

/**
 * Unlike useDeploymentsQuery, this hook is not tied to useDevelopPageStore
 * and can be used in any context (e.g., manage-plan page).
 *
 * @param options.appId - The app ID to poll deployments for
 * @param options.deploymentId - The specific deployment ID to track (null to disable)
 * @param options.onComplete - Callback when deployment reaches terminal status
 */
export function useDeploymentStatusPolling({
  appId,
  deploymentId,
  onComplete,
}: UseDeploymentStatusPollingOptions) {
  return useQuery({
    queryKey: ['deployment-status', appId, deploymentId],
    queryFn: async ({ meta }): Promise<DeploymentStatus | null> => {
      if (!appId || !deploymentId) {
        return null;
      }

      // Set polling start time on first fetch (for timeout calculation)
      if (!meta?.pollingStartedAt) {

        (meta as any).pollingStartedAt = Date.now();
      }

      try {
        const response = await appFetch(`/api/apps/${appId}/deployments?limit=5`, {
          cache: 'no-store',
        });

        if (!response.ok) {
          logger.warn('deployment-status-poll.fetch-failed', {
            appId,
            deploymentId,
            status: response.status,
          });
          return null;
        }

        const data = await response.json();
        const deployments: AiroDeployment[] = Array.isArray(data) ? data : data.deployments || [];
        const deployment = deployments.find((d) => d.id === deploymentId);

        if (!deployment) {
          return null;
        }

        const status = deployment.status as DeploymentStatus;

        // Call onComplete callback when terminal status reached
        if (TERMINAL_STATUSES.includes(status)) {
          logger.info('deployment-status-poll.complete', {
            appId,
            deploymentId,
            status,
          });
          onComplete?.(status);
        }

        return status;
      } catch (error) {
        logger.error('deployment-status-poll.error', {
          appId,
          deploymentId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    enabled: !!appId && !!deploymentId,
    meta: { pollingStartedAt: null as number | null },
    refetchInterval: (query) => {
      const status = query.state.data;

      // Stop polling if deployment reached terminal status
      if (status && TERMINAL_STATUSES.includes(status)) {
        return false;
      }

      // Stop polling after max duration from first poll (handles stuck deployments)
      const pollingStartedAt = query.meta?.pollingStartedAt as number | null;
      if (pollingStartedAt && Date.now() - pollingStartedAt > MAX_POLL_DURATION_MS) {
        logger.warn('deployment-status-poll.timeout', {
          appId,
          deploymentId,
          elapsedMs: Date.now() - pollingStartedAt,
        });
        return false;
      }

      return POLL_INTERVAL_MS;
    },
    staleTime: 0,
    gcTime: 0,
  });
}

export function isTerminalStatus(status: DeploymentStatus | null | undefined): boolean {
  return !!status && TERMINAL_STATUSES.includes(status);
}

async function fetchDeploymentStatus(
  appId: string,
  deploymentId: string
): Promise<DeploymentStatus | null> {
  try {
    const response = await appFetch(`/api/apps/${appId}/deployments?limit=5`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      logger.warn('deployment-status-poll.fetch-failed', {
        appId,
        deploymentId,
        status: response.status,
      });
      return null;
    }

    const data = await response.json();
    const deployments: AiroDeployment[] = Array.isArray(data) ? data : data.deployments || [];
    const deployment = deployments.find((d) => d.id === deploymentId);

    if (!deployment) {
      return null;
    }

    return deployment.status as DeploymentStatus;
  } catch (error) {
    logger.error('deployment-status-poll.error', {
      appId,
      deploymentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * React Query hook for polling multiple deployment statuses simultaneously
 *
 * Uses useQueries to track multiple deployments at once. Each deployment
 * is polled independently and the onComplete callback is called when
 * any deployment reaches a terminal status.
 *
 * @param options.deployments - Array of {appId, deploymentId} to track
 * @param options.onComplete - Callback when a deployment reaches terminal status
 */
export function useMultipleDeploymentStatusPolling({
  deployments,
  onComplete,
}: UseMultipleDeploymentStatusPollingOptions) {
  return useQueries({
    queries: deployments.map(({ appId, deploymentId }) => ({
      queryKey: ['deployment-status', appId, deploymentId],
      queryFn: async ({ meta }): Promise<{ appId: string; status: DeploymentStatus | null }> => {
        // Set polling start time on first fetch (for timeout calculation)
        if (!meta?.pollingStartedAt) {

          (meta as any).pollingStartedAt = Date.now();
        }

        const status = await fetchDeploymentStatus(appId, deploymentId);

        // Call onComplete callback when terminal status reached
        if (status && TERMINAL_STATUSES.includes(status)) {
          logger.info('deployment-status-poll.complete', {
            appId,
            deploymentId,
            status,
          });
          onComplete?.(appId, status);
        }

        return { appId, status };
      },
      meta: { pollingStartedAt: null as number | null },
      refetchInterval: (query: DeploymentStatusQueryState) => {
        const status = query.state.data?.status;

        // Stop polling if deployment reached terminal status
        if (status && TERMINAL_STATUSES.includes(status)) {
          return false;
        }

        // Stop polling after max duration from first poll (handles stuck deployments)
        const pollingStartedAt = query.meta?.pollingStartedAt;
        if (pollingStartedAt && Date.now() - pollingStartedAt > MAX_POLL_DURATION_MS) {
          logger.warn('deployment-status-poll.timeout', {
            appId,
            deploymentId,
            elapsedMs: Date.now() - pollingStartedAt,
          });
          return false;
        }

        return POLL_INTERVAL_MS;
      },
      staleTime: 0,
      gcTime: 0,
    })),
  });
}

// Domain disconnect polling

const DOMAIN_POLL_INTERVAL_MS = 5000;
const DOMAIN_MAX_POLL_DURATION_MS = 2 * 60 * 1000; // 2 minutes max

interface DomainToTrack {
  appId: string;
  domainFqdn: string;
}

interface UseDomainDisconnectPollingOptions {
  domains: DomainToTrack[];
  onComplete?: (appId: string) => void;
  onTimeout?: (appId: string) => void;
}

/**
 * Fetch site details to check if domain still exists
 */
async function fetchSiteDomains(appId: string): Promise<AiroDomain[] | null> {
  try {
    const response = await appFetch(`/api/sites/${appId}`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      logger.warn('domain-disconnect-poll.fetch-failed', {
        appId,
        status: response.status,
      });
      return null;
    }

    const data = await response.json();
    return data.domains || [];
  } catch (error) {
    logger.error('domain-disconnect-poll.error', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Query state shape for domain disconnect polling refetchInterval */
interface DomainDisconnectQueryState {
  state: { data?: { removed: boolean; timedOut: boolean } };
  meta?: { pollingStartedAt?: number | null };
}

/** State tracked per domain for polling callbacks */
interface DomainPollingState {
  pollingStartedAt: number | null;
  timeoutCalled: boolean;
  onCompleteCalled: boolean;
}

/**
 * React Query hook for polling domain disconnect status
 *
 * Polls site details endpoint to check when a domain has been removed.
 * Calls onComplete when the domain is no longer in the site's domain list.
 * Calls onTimeout when polling times out without the domain being removed.
 *
 * @param options.domains - Array of {appId, domainFqdn} to track
 * @param options.onComplete - Callback when domain is removed from site
 * @param options.onTimeout - Callback when polling times out
 */
export function useDomainDisconnectPolling({
  domains,
  onComplete,
  onTimeout,
}: UseDomainDisconnectPollingOptions) {
  // Use ref to track polling state per domain - more reliable than meta which may be recreated
  const pollingStateRef = useRef<Map<string, DomainPollingState>>(new Map());

  // Reset polling state when a domain is added to ensure fresh callbacks on re-track
  // This runs once per domain addition, keyed by the stable query key
  const getOrResetPollingState = (appId: string, domainFqdn: string): DomainPollingState => {
    const key = `${appId}:${domainFqdn}`;
    const existing = pollingStateRef.current.get(key);

    // If state exists and polling already completed/timed out, it's stale from a previous session
    // Reset it for the new polling session
    if (existing && (existing.onCompleteCalled || existing.timeoutCalled)) {
      const fresh: DomainPollingState = { pollingStartedAt: null, timeoutCalled: false, onCompleteCalled: false };
      pollingStateRef.current.set(key, fresh);
      return fresh;
    }

    if (!existing) {
      const fresh: DomainPollingState = { pollingStartedAt: null, timeoutCalled: false, onCompleteCalled: false };
      pollingStateRef.current.set(key, fresh);
      return fresh;
    }

    return existing;
  };

  return useQueries({
    queries: domains.map(({ appId, domainFqdn }) => ({
      queryKey: ['domain-disconnect', appId, domainFqdn],
      queryFn: async (): Promise<{ appId: string; domainFqdn: string; removed: boolean; timedOut: boolean }> => {
        const state = getOrResetPollingState(appId, domainFqdn);

        // Set polling start time on first fetch (for timeout calculation)
        if (state.pollingStartedAt === null) {
          state.pollingStartedAt = Date.now();
        }

        // Check for timeout
        if (state.pollingStartedAt && Date.now() - state.pollingStartedAt > DOMAIN_MAX_POLL_DURATION_MS) {
          if (!state.timeoutCalled) {
            state.timeoutCalled = true;
            logger.warn('domain-disconnect-poll.timeout', {
              appId,
              domainFqdn,
              elapsedMs: Date.now() - state.pollingStartedAt,
            });
            onTimeout?.(appId);
          }
          return { appId, domainFqdn, removed: false, timedOut: true };
        }

        const appDomains = await fetchSiteDomains(appId);

        if (appDomains === null) {
          // Fetch failed, keep polling
          return { appId, domainFqdn, removed: false, timedOut: false };
        }

        const domainStillExists = appDomains.some((d) => d.fqdn === domainFqdn);

        if (!domainStillExists) {
          // Guard against calling onComplete multiple times (e.g., on window focus refetch)
          if (!state.onCompleteCalled) {
            state.onCompleteCalled = true;
            logger.info('domain-disconnect-poll.complete', {
              appId,
              domainFqdn,
            });
            onComplete?.(appId);
          }
        }

        return { appId, domainFqdn, removed: !domainStillExists, timedOut: false };
      },
      refetchInterval: (query: DomainDisconnectQueryState) => {
        // Stop polling if domain was removed or timed out
        if (query.state.data?.removed || query.state.data?.timedOut) {
          return false;
        }

        return DOMAIN_POLL_INTERVAL_MS;
      },
      staleTime: 0,
      gcTime: 0,
    })),
  });
}
