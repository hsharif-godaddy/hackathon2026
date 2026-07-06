import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getSwitchboardFlag } from '@/hooks/useSwitchboard';
import { agentFetch } from '@/lib/agent-fetch';
import { DomainType } from '@/lib/control-plane/types';
import { appFetch, AuthDismissedError, AuthSessionExpiredError } from '@/lib/gasket-config';
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
export const MAX_POLLING_DURATION_MS = 5 * 60 * 1000;  // Stop polling after 5 minutes

/**
 * Options for useDeploymentsQuery hook
 */
export interface UseDeploymentsQueryOptions {
  appId: string;
  limit?: number;
  includeJobData?: boolean;
  dedupe?: boolean;
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
 * @param options.dedupe - Whether to deduplicate by gitHash (default: true)
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
  dedupe = true,
  enabled = true,
}: UseDeploymentsQueryOptions) {
  // Track when polling started for progressive intervals
  const pollingStartTimeRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  // Get store methods to check and clear deployment in progress
  const getPublishState = useDevelopPageStore((state) => state.getPublishState);
  const setDeploymentInProgressId = useDevelopPageStore((state) => state.setDeploymentInProgressId);
  const setPublishSuccess = useDevelopPageStore((state) => state.setPublishSuccess);
  const setShowFirstPublishCongrats = useDevelopPageStore((state) => state.setShowFirstPublishCongrats);
  const setFirstPublishDeployPending = useDevelopPageStore((state) => state.setFirstPublishDeployPending);
  const setShowGoLiveModal = useDevelopPageStore((state) => state.setShowGoLiveModal);
  const hasGoneLive = useDevelopPageStore((state) => state.hasGoneLive);
  const fetchSite = useSiteStore((state) => state.fetchSite);
  const getSite = useSiteStore((state) => state.getSite);

  const query = useQuery({
    queryKey: ['deployments', appId, limit, includeJobData, dedupe],
    queryFn: async (): Promise<AiroDeployment[]> => {
      if (!appId) {
        return [];
      }

      const queryParams = new URLSearchParams({
        limit: limit.toString(),
        includeJobData: includeJobData.toString(),
      });
      if (!dedupe) {
        queryParams.set('dedupe', 'false');
      }

      logger.debug('deployments-query.fetch.start', {
        message: 'Fetching deployments via React Query',
        appId,
        limit,
        includeJobData,
        dedupe,
      });

      // handle401 routes a 401 through resolveAuth's single-flight mutex so a
      // burst of poll requests during a publish flow share one SSO modal
      // instead of stacking up. If re-auth succeeds appFetch retries the
      // request once; if the user dismisses, AuthDismissedError surfaces and
      // the retry predicate below stops React Query from re-firing.
      const response = await appFetch(
        `/api/apps/${appId}/deployments?${queryParams.toString()}`,
        { cache: 'no-store' },
        { handle401: true }
      );

      if (!response.ok) {
        const publishState = getPublishState(appId);
        if (publishState.deploymentInProgressId) {
          logger.warn('deployments-query.fetch.error-during-polling', {
            appId,
            deploymentId: publishState.deploymentInProgressId,
            status: response.status,
          });
          pollingStartTimeRef.current = null;
          setDeploymentInProgressId(appId, null);
          setFirstPublishDeployPending(appId, false);
        }
        const errorMessage = `Failed to fetch deployments: ${response.status} ${response.statusText}`;
        if (response.status === 401) {
          // appFetch already drove the SSO modal via handle401; surface a
          // typed error so the retry predicate can short-circuit instead of
          // re-firing the poll while the user is still authenticating.
          throw new AuthSessionExpiredError();
        }
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
    // Auth failures are funneled through resolveAuth (single-flight). React
    // Query must not retry them: re-firing the request while the modal is
    // still open stacks 401s and races SSO completion.
    retry: (failureCount, error) => {
      if (error instanceof AuthDismissedError) return false;
      if (error instanceof AuthSessionExpiredError) return false;
      return failureCount < 1;
    },
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
          if (!pollingStartTimeRef.current) return false;

          const elapsed = Date.now() - pollingStartTimeRef.current;

          // Stop polling after 5 minutes max (timeout)
          if (elapsed >= MAX_POLLING_DURATION_MS) {
            logger.warn('deployments-query.polling.timeout', {
              appId,
              deploymentId: deploymentInProgressId,
              elapsedMs: elapsed,
              elapsedMinutes: Math.round(elapsed / 60000),
              message: 'Polling stopped after 5 minutes - deployment may be stuck'
            });
            pollingStartTimeRef.current = null;
            setDeploymentInProgressId(appId, null);
            setFirstPublishDeployPending(appId, false);
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
        const wasAlreadyPublished = hasBeenPublished(currentSiteData);
        const pendingFirstPublish = publishState.firstPublishDeployPending;
        const isFirstPublish = pendingFirstPublish || !wasAlreadyPublished;

        shipAnalyticsLog('publish.success', {
          appId,
          domain: currentSiteData?.name,
          deploymentId: deploymentInProgressId,
          commitHash: deploymentInProgress.gitHash,
          isFirstPublish,
        });

        if (isFirstPublish) {
          setShowFirstPublishCongrats(appId, true);
        }

        setFirstPublishDeployPending(appId, false);

        // Determine event IDs based on whether this is first publish or re-publish
        const impressionEid = isFirstPublish
          ? 'develop.publish.first_publish_success'
          : 'develop.publish.publish_success';

        const airoHQTask = isFirstPublish
          ? 'builder_project_first_published'
          : 'builder_project_published';

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

        // Refetch site after deploy (first-publish congrats is not gated on go-live)
        fetchSite(appId, true)
          .then(async function handleRefetchSuccess() {
            // Always clear publishing state on successful deployment
            setPublishSuccess(appId, true);

            // Push publish state to agent so context is accurate on next chat message
            void (async () => {
              try {
                const site = useSiteStore.getState().getSite(appId);
                if (!site?.agent_url) return;
                await agentFetch(`${site.agent_url}/apps/${appId}/publish-state`, {
                  siteId: appId,
                  method: 'POST',
                  body: JSON.stringify({
                    publishedUrl: site.published_url ?? null,
                    domains: (site.domains ?? [])
                      .filter(d => d.domainType !== DomainType.PREFIX)
                      .map(d => ({
                        fqdn: d.fqdn,
                        isPrimary: d.isPrimary,
                        status: d.status,
                      })),
                  }),
                });
              } catch (err) {
                logger.warn('deployments-query.publish-state-push.failed', {
                  appId,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            })();

            const isGoLiveEnabled = getSwitchboardFlag('appbuilder-go-live') === true;
            const userHasGoneLive = hasGoneLive(appId);
            const wasDismissed = getPublishState(appId).goLiveModalDismissed;

            if (isGoLiveEnabled && isFirstPublish && !userHasGoneLive && !wasDismissed) {
              setShowGoLiveModal(appId, true);
              logger.info('deployments-query.showing-go-live-modal', {
                appId,
                isFirstPublish,
                userHasGoneLive
              });
            }
          })
          .catch(function handleFetchError(error) {
            logger.error('deployments-query.site-refetch.error', {
              appId,
              error: error instanceof Error ? error.message : String(error),
            });
            setShowFirstPublishCongrats(appId, false);
            // Still show success alert even if refetch fails
            setPublishSuccess(appId, true);
          });
      } else if (deploymentInProgress.status === DeploymentStatus.FAILED) {
        setFirstPublishDeployPending(appId, false);
        const currentSiteData = getSite(appId);
        const failureReason = deploymentInProgress.metadata?.errorMessage
          ?? deploymentInProgress.job?.errorMessage
          ?? 'unknown'
        shipAnalyticsLog('publish.failed', {
          appId,
          domain: currentSiteData?.name,
          deploymentId: deploymentInProgressId,
          commitHash: deploymentInProgress.gitHash,
          failureReason,
        });

        logImpressionEvent('develop.publish.failed', {
          appId,
          failureReason: String(failureReason).substring(0, 200),
        })();
      }

      // Clear deployment tracking
      setDeploymentInProgressId(appId, null);
    }
  }, [query.data, appId, getPublishState, setDeploymentInProgressId, setFirstPublishDeployPending, setPublishSuccess, setShowFirstPublishCongrats, setShowGoLiveModal, hasGoneLive, fetchSite, getSite, queryClient]);

  return query;
}
