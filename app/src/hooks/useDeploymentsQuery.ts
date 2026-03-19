import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchFeatureFlag } from '@/hooks/useSwitchboard';
import { appFetch } from '@/lib/gasket-config';
import { shipAnalyticsLog } from '@/lib/logging';
import type { AiroDeployment } from '@/lib/mgmt-airo';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

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
 * When a deployment completes successfully (reaches 'deployed' status), this hook
 * automatically triggers a success alert via the useDevelopPageStore.
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
}: UseDeploymentsQueryOptions) {
  // Track when polling started for progressive intervals
  const pollingStartTimeRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  // Get store methods to check and clear deployment in progress
  const getPublishState = useDevelopPageStore((state) => state.getPublishState);
  const setDeploymentInProgressId = useDevelopPageStore((state) => state.setDeploymentInProgressId);
  const setPublishSuccess = useDevelopPageStore((state) => state.setPublishSuccess);
  const setShowGoLiveModal = useDevelopPageStore((state) => state.setShowGoLiveModal);
  const hasGoneLive = useDevelopPageStore((state) => state.hasGoneLive);
  const fetchSite = useSiteStore((state) => state.fetchSite);
  const getSite = useSiteStore((state) => state.getSite);

  const query = useQuery({
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
        `/api/apps/${appId}/deployments?${queryParams.toString()}`,
        { cache: 'no-store' }
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

      return deployments;
    },
    enabled: enabled && !!appId,
    refetchInterval: (query) => {
          const data = query.state.data;

          // Check if we have a deployment in progress from publish
          const publishState = getPublishState(appId);
          const deploymentInProgressId = publishState.deploymentInProgressId;

          // If no deployment being tracked, don't poll
          if (!deploymentInProgressId) {
            pollingStartTimeRef.current = null;
            return false;
          }

          // Find the deployment in progress if it exists in current data
          const deploymentInProgress = data?.find(d => d.id === deploymentInProgressId);

          // If deployment is in final state, stop polling
          if (deploymentInProgress && ['deployed', 'failed'].includes(deploymentInProgress.status)) {
            pollingStartTimeRef.current = null;
            return false;
          }

          // Start polling immediately if we have a deploymentInProgressId
          if (!pollingStartTimeRef.current) {
            pollingStartTimeRef.current = Date.now();
            logger.info('deployments-query.polling.started', {
              appId,
              deploymentId: deploymentInProgressId,
            });
          }

          // Calculate progressive interval
          if (!pollingStartTimeRef.current) {return false;}

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
        },
    staleTime: 0,
  });

  // Handle deployment completion side effects
  useEffect(function handleDeploymentCompletion() {
    const deployments = query.data;
    const publishState = getPublishState(appId);
    const deploymentInProgressId = publishState.deploymentInProgressId;

    if (!deploymentInProgressId || !deployments) {
      return;
    }

    const deploymentInProgress = deployments.find(d => d.id === deploymentInProgressId);

    if (deploymentInProgress && [DeploymentStatus.DEPLOYED, DeploymentStatus.FAILED].includes(deploymentInProgress.status as DeploymentStatus)) {
      if (deploymentInProgress.status === DeploymentStatus.DEPLOYED) {
        logger.info('deployments-query.deployment-complete', {
          appId,
          deploymentId: deploymentInProgressId,
          status: DeploymentStatus.DEPLOYED,
        });

        // Check if site was already published before this deployment
        const currentSiteData = getSite(appId);

        // Ship analytics log for Elastic dashboards
        shipAnalyticsLog('publish.success', {
          appId,
          domain: currentSiteData?.name,
          deploymentId: deploymentInProgressId,
          isFirstPublish: !hasBeenPublished(currentSiteData)
        });
        const wasAlreadyPublished = hasBeenPublished(currentSiteData);

        // Determine event IDs based on whether this is first publish or re-publish
        const impressionEid = wasAlreadyPublished
          ? 'develop.publish.publish_success'
          : 'develop.publish.first_publish_success';

        const airoHQTask = wasAlreadyPublished
          ? 'builder_project_published'
          : 'builder_project_first_published';

        // Log events BEFORE refetch (deployment already updated backend with publish variant)
        logImpressionEvent(impressionEid)();

        logAiroHQEvent({
          category: 'click',
          recommendation_task: airoHQTask,
          recommendation_type: 'publish',
          recommendation_id: appId,
          completedTask: true,
        })();

        // Invalidate git history cache to refresh commit list with deployment tag
        queryClient.invalidateQueries({ queryKey: ['git-history', appId] });

        // Invalidate secrets diff — workflow-based secrets sync (V2) completes by deployment time
        queryClient.invalidateQueries({ queryKey: ['secretsDiff', appId] });

        // Refetch git history and select the published commit
        void (async function handleGitHistoryRefetch() {
          try {
            await queryClient.refetchQueries({ queryKey: ['git-history', appId] });
          } catch (error) {
            logger.error('deployments-query.git-history-refetch.error', {
              appId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();

        // Refetch site data to get updated domains/URLs/variants, then show success or go-live modal
        fetchSite(appId, true)
          .then(async function handleRefetchSuccess() {
            // Check if go-live feature is enabled
            const isGoLiveEnabled = await fetchFeatureFlag('appbuilder-go-live');

            // Check if this is first publish and user hasn't gone live yet
            const isFirstPublish = !wasAlreadyPublished;
            const userHasGoneLive = hasGoneLive(appId);
            const wasDismissed = getPublishState(appId).goLiveModalDismissed;

            if (isGoLiveEnabled && isFirstPublish && !userHasGoneLive && !wasDismissed) {
              // Show go-live modal for first-time publishers
              setShowGoLiveModal(appId, true);
              logger.info('deployments-query.showing-go-live-modal', {
                appId,
                isFirstPublish,
                userHasGoneLive
              });
            } else {
              // Show normal success alert for subsequent publishes or users who already went live
              setPublishSuccess(appId, true);
            }
          })
          .catch(function handleFetchError(error) {
            logger.error('deployments-query.site-refetch.error', {
              appId,
              error: error instanceof Error ? error.message : String(error),
            });
            // Still show success alert even if refetch fails
            setPublishSuccess(appId, true);
          });
      } else if (deploymentInProgress.status === DeploymentStatus.FAILED) {
        const currentSiteData = getSite(appId);
        shipAnalyticsLog('publish.failed', {
          appId,
          domain: currentSiteData?.name,
          deploymentId: deploymentInProgressId
        });
      }

      // Clear deployment tracking
      setDeploymentInProgressId(appId, null);
    }
  }, [query.data, appId, getPublishState, setDeploymentInProgressId, setPublishSuccess, setShowGoLiveModal, hasGoneLive, fetchSite, getSite, queryClient]);

  return query;
}
