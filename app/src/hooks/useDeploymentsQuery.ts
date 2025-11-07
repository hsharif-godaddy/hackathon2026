import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import type { AiroDeployment } from '@/lib/mgmt-airo';

const INITIAL_POLL_DELAY_MS = 5000;  // Wait 5 seconds before first poll
const FAST_POLLING_INTERVAL_MS = 2000;  // Poll every 2 seconds initially
const SLOW_POLLING_INTERVAL_MS = 10000;  // Poll every 10 seconds after 3 minutes
const FAST_POLLING_DURATION_MS = 3 * 60 * 1000;  // 3 minutes
const MAX_POLLING_DURATION_MS = 5 * 60 * 1000;  // Stop polling after 5 minutes

/**
 * Options for useDeploymentsQuery hook
 */
export interface UseDeploymentsQueryOptions {
  appId: string;
  limit?: number;
  includeJobData?: boolean;
  enabled?: boolean;
  refetchInterval?: number | false;
  shouldPoll?: (data: AiroDeployment[] | undefined) => boolean;
}

/**
 * React Query hook for fetching deployment data
 *
 * Uses TanStack Query for automatic caching, background refetching, and polling.
 * Includes built-in support for polling while deployment is in progress with
 * progressive intervals:
 * - First poll after 5 seconds
 * - Then every 2 seconds for the first 3 minutes
 * - Then every 10 seconds until deployment completes or 5 minute timeout
 * - Stops polling after 5 minutes max (prevents infinite polling on stuck deployments)
 *
 * @param options - Configuration options
 * @param options.appId - App ID (required)
 * @param options.limit - Number of deployments to fetch (default: 20)
 * @param options.includeJobData - Whether to include job data (default: true)
 * @param options.enabled - Whether the query should be enabled (default: true)
 * @param options.refetchInterval - Polling interval in ms, or false to disable (default: false)
 * @param options.shouldPoll - Function that determines if polling should continue based on data.
 *                             When provided, enables automatic progressive polling.
 * @returns Query result with deployments data
 *
 * @example
 * ```typescript
 * // Basic usage
 * const { data: deployments, isLoading } = useDeploymentsQuery({
 *   appId: 'app-789'
 * });
 *
 * // Auto-polling with progressive intervals based on deployment status
 * const { data: deployments } = useDeploymentsQuery({
 *   appId: 'app-789',
 *   shouldPoll: (data) => {
 *     const latest = data?.[0];
 *     return latest && !['deployed', 'failed'].includes(latest.status);
 *   }
 * });
 * ```
 */
export function useDeploymentsQuery({
  appId,
  limit = 20,
  includeJobData = true,
  enabled = true,
  refetchInterval = false,
  shouldPoll,
}: UseDeploymentsQueryOptions) {
  // Track when polling started for progressive intervals
  const pollingStartTimeRef = useRef<number | null>(null);

  return useQuery({
    queryKey: ['deployments', appId, limit, includeJobData],
    queryFn: async (): Promise<AiroDeployment[]> => {
      if (!appId) {
        return [];
      }

      const queryParams = new URLSearchParams({
        limit: limit.toString(),
        includeJobData: includeJobData.toString(),
      });

      logger.debug('deployments-query.fetch.start', {
        message: 'Fetching deployments via React Query',
        appId,
        limit,
        includeJobData,
      });

      const response = await appFetch(
        `/api/apps/${appId}/deployments?${queryParams.toString()}`
      );

      if (!response.ok) {
        const errorMessage = `Failed to fetch deployments: ${response.status} ${response.statusText}`;
        logger.error('deployments-query.fetch.failure', {
          message: errorMessage,
          appId,
        });
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const deployments = Array.isArray(data) ? data : data.deployments || [];

      logger.info('deployments-query.fetch.success', {
        message: 'Deployments fetched',
        appId,
        count: deployments.length,
      });

      return deployments;
    },
    enabled: enabled && !!appId,
    // Use progressive polling if shouldPoll is provided, otherwise use refetchInterval
    refetchInterval: shouldPoll 
      ? (query) => {
          const data = query.state.data;
          const shouldContinuePolling = shouldPoll(data);
          
          // Start/stop tracking polling time
          if (shouldContinuePolling && !pollingStartTimeRef.current) {
            pollingStartTimeRef.current = Date.now();
            const latestDeployment = data?.[0];
            logger.info('deployments-query.polling.started', {
              appId,
              deploymentId: latestDeployment?.id,
              status: latestDeployment?.status
            });
          } else if (!shouldContinuePolling && pollingStartTimeRef.current) {
            const duration = Date.now() - pollingStartTimeRef.current;
            logger.info('deployments-query.polling.stopped', {
              appId,
              durationMs: duration,
              durationSeconds: Math.round(duration / 1000)
            });
            pollingStartTimeRef.current = null;
          }
          
          if (!shouldContinuePolling) {
            return false;
          }
          
          // Calculate progressive interval
          if (!pollingStartTimeRef.current) return false;
          
          const elapsed = Date.now() - pollingStartTimeRef.current;
          
          // Stop polling after 5 minutes max (timeout)
          if (elapsed >= MAX_POLLING_DURATION_MS) {
            logger.warn('deployments-query.polling.timeout', {
              appId,
              elapsedMs: elapsed,
              elapsedMinutes: Math.round(elapsed / 60000),
              message: 'Polling stopped after 5 minutes - deployment may be stuck'
            });
            pollingStartTimeRef.current = null;
            return false;
          }
          
          // First poll: wait 5 seconds
          if (elapsed < INITIAL_POLL_DELAY_MS) {
            return INITIAL_POLL_DELAY_MS - elapsed;
          }
          
          // After initial delay, poll every 2 seconds for first 3 minutes
          if (elapsed < FAST_POLLING_DURATION_MS) {
            return FAST_POLLING_INTERVAL_MS;
          }
          
          // After 3 minutes, poll every 10 seconds (until 5 minute timeout)
          return SLOW_POLLING_INTERVAL_MS;
        }
      : refetchInterval,
    staleTime: 0,
  });
}

