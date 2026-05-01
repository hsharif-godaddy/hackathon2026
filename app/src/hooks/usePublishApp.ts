import { useMutation, useQueryClient } from '@tanstack/react-query';

import { dynamicApiConfigService } from '@/config/dynamic-api';
import {
  appDetailsQueryKey,
  type AppDetailsResponse,
  fetchAppDetails,
} from '@/hooks/useAppDetails';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { appFetch, AuthDismissedError, authPreflight } from '@/lib/gasket-config';
import { regenerateToken } from '@/lib/jwt-regeneration';
import type { AiroSubscription } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import {
  getPublishComplianceBlockReason,
  isPublishBlockedByComplianceRules,
  PublishComplianceBlockReason
} from '@/lib/subscription';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { hasBeenPublished } from '@/utils/site';

/**
 * Response from the publish API endpoint
 */
interface PublishResponse {
  success: boolean;
  commitHash: string;
  archive: {
    path: string;
  };
  deployment?: {
    deploymentId: string;
    statusJobId: string;
    status: string;
    message: string;
  };
  published?: boolean; // Flag for local dev: true when publish succeeded immediately
  publishUrl?: string; // URL of the published site for local dev
}

/**
 * Parameters for the publish mutation
 */
interface PublishParams {
  appId: string;
  dnsUpdateConsent?: boolean;
}

/**
 * Result returned from the mutation
 */
interface PublishResult {
  result: PublishResponse;
  commitHash: string;
}

/**
 * Handle successful local dev publish
 *
 * Local dev flow is completely separate from production:
 * 1. Store the published commit hash
 * 2. Clear publishing state immediately (no polling)
 * 3. Refetch site to get updated variants (computed from published_url)
 * 4. Show success alert
 * 5. Invalidate git history
 */
async function handleLocalDevPublishSuccess(
  appId: string,
  commitHash: string,
  queryClient: ReturnType<typeof useQueryClient>,
  setLastPublishedCommitHash: (appId: string, hash: string) => void,
  setIsPublishing: (appId: string, isPublishing: boolean) => void,
  setPublishSuccess: (appId: string, success: boolean) => void,
  fetchSite: (appId: string, forceRefresh: boolean) => Promise<any>,
  fetchSitesList: (siteId: string) => Promise<any>
) {
  const siteBeforePublish = useSiteStore.getState().getSite(appId);
  const pendingFirstPublish =
    useDevelopPageStore.getState().getPublishState(appId).firstPublishDeployPending;
  const isFirstPublish = pendingFirstPublish || !hasBeenPublished(siteBeforePublish);

  if (isFirstPublish) {
    useDevelopPageStore.getState().setShowFirstPublishCongrats(appId, true);
  }

  // Store published commit hash for unpublished changes tracking
  setLastPublishedCommitHash(appId, commitHash);

  // Clear publishing state immediately (no deployment polling in local dev)
  setIsPublishing(appId, false);

  // Refetch site to get fresh data with updated variants
  try {
    // Update both stores to keep them in sync
    await Promise.all([
      fetchSite(appId, true), // Updates useSiteStore
      fetchSitesList(appId),  // Updates useSitesStore
    ]);
    // Site now has variants: ['preview', 'publish'] computed from published_url
    // Show success alert
    setPublishSuccess(appId, true);
  } catch (error) {
    logger.error('publish.local-dev.site-refetch.error', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    useDevelopPageStore.getState().setShowFirstPublishCongrats(appId, false);
    // Still show success alert even if refetch fails
    setPublishSuccess(appId, true);
  }

  // Invalidate git history and secrets diff in parallel to reflect the completed sync
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ['git-history', appId],
      refetchType: 'active'
    }),
    queryClient.invalidateQueries({
      queryKey: ['secretsDiff', appId],
      refetchType: 'active'
    }),
  ]);

  useDevelopPageStore.getState().setFirstPublishDeployPending(appId, false);
}

const MAX_DEPLOYMENT_WAIT_MS = 5 * 60 * 1000;

function waitForDeploymentComplete(appId: string, deploymentId: string): Promise<boolean> {
  return new Promise(function awaitDeployment(resolve) {
    const timeout = setTimeout(function handleTimeout() {
      unsubscribe();
      logger.warn('publish.snapshot-wait.timeout', { appId, deploymentId });
      resolve(false);
    }, MAX_DEPLOYMENT_WAIT_MS);

    function check(state: ReturnType<typeof useDevelopPageStore.getState>) {
      const publishState = state.publishStates[appId];
      if (!publishState || publishState.deploymentInProgressId !== null) return false;
      clearTimeout(timeout);
      unsubscribe();
      resolve(!publishState.publishError);
      return true;
    }

    const unsubscribe = useDevelopPageStore.subscribe(check);
    check(useDevelopPageStore.getState());
  });
}

/**
 * React Query hook for publishing an app
 *
 * Handles two completely separate flows:
 *
 * PRODUCTION FLOW:
 * 1. Publish request returns deployment.deploymentId
 * 2. Set deploymentInProgressId in store
 * 3. useDeploymentsQuery starts polling mgmt-airo
 * 4. When deployment status = 'deployed', show success alert
 *
 * LOCAL DEV FLOW:
 * 1. Publish request returns published: true (instant)
 * 2. Store commit hash, clear publishing state
 * 3. Refetch site (variants computed from published_url)
 * 4. Show success alert immediately
 *
 * @returns Mutation object with mutate, mutateAsync, isLoading, isError, error, data
 *
 * @example
 * ```tsx
 * const publishMutation = usePublishApp();
 *
 * const handlePublish = async () => {
 *   try {
 *     const result = await publishMutation.mutateAsync({ appId: 'app-123' });
 *     console.log('Published:', result.commitHash);
 *   } catch (error) {
 *     console.error('Publish failed:', error);
 *   }
 * };
 * ```
 */
export function usePublishApp() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const setLastPublishedCommitHash = useDevelopPageStore((state) => state.setLastPublishedCommitHash);
  const setDeploymentInProgressId = useDevelopPageStore((state) => state.setDeploymentInProgressId);
  const setBuildErrorDetails = useDevelopPageStore((state) => state.setBuildErrorDetails);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishSuccess = useDevelopPageStore((state) => state.setPublishSuccess);
  const fetchSite = useSiteStore((state) => state.fetchSite);
  const fetchSitesList = useSitesStore((state) => state.fetchSite);
  const isSecretsSyncEnabled = useSwitchboard('appbuilder-settings-secrets');

  return useMutation<PublishResult, Error, PublishParams>({
    mutationFn: async ({ appId, dnsUpdateConsent }) => {
      const preflightFailure = await authPreflight(3);
      if (preflightFailure) throw new Error('Authentication required');
      await queryClient.invalidateQueries({ queryKey: ['app-details', appId] });
      const site = await queryClient.fetchQuery<AppDetailsResponse>({
        queryKey: appDetailsQueryKey(appId),
        queryFn: () => fetchAppDetails(appId),
      });
      const cachedSubs = queryClient.getQueryData<{
        subscriptions: AiroSubscription[];
        active: AiroSubscription | null;
      }>(['subscriptions']);
      const subscription = cachedSubs?.active ?? undefined;
      const complianceFlag =
        queryClient.getQueryData<boolean>(['featureFlag', 'appbuilder-suspended-compliance-banner']) === true;
      if (isPublishBlockedByComplianceRules(site, subscription, complianceFlag)) {
        const blockReason = getPublishComplianceBlockReason(site, subscription, complianceFlag);
        throw new Error(
          blockReason === PublishComplianceBlockReason.SiteSuspended
            ? t('builder_manageplan_apps_publish_blocked_suspended')
            : t('builder_manageplan_apps_publish_blocked_subscription')
        );
      }

      useDevelopPageStore.getState().setFirstPublishDeployPending(
        appId,
        !hasBeenPublished(site),
      );

      if (isSecretsSyncEnabled) {
        try {
          const syncResponse = await appFetch(`/api/secrets/${appId}/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              source: 'preview',
              destination: 'publish'
            }),
          });

          if (!syncResponse.ok) {
            // Log warning but don't fail publish - secrets sync is non-critical
            logger.warn('publish.secrets-sync.failed', {
              appId,
              status: syncResponse.status,
              message: 'Secrets sync failed but continuing with publish'
            });
          } else {
            // Consume response body to prevent connection issues
            await syncResponse.json();
          }
        } catch (syncError) {
          // Log error but don't fail publish - secrets sync is non-critical
          logger.warn('publish.secrets-sync.error', {
            appId,
            error: syncError instanceof Error ? syncError.message : String(syncError),
            message: 'Secrets sync error but continuing with publish'
          });
        }
      }

      // Regenerate JWT and fetch agent URL in parallel (independent lookups)
      logger.info('publish.regenerate-token', { appId });
      const [tokenResult, apiConfig] = await Promise.all([
        regenerateToken({ siteId: appId, force: true }),
        dynamicApiConfigService.getConfigForSite(appId),
      ]);

      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available for this site');
      }

      // Call agent service directly with fresh token
      const publishUrl = `${apiConfig.agentUrl}/apps/${appId}/publish`;
      logger.info('publish.calling-agent', { appId, url: publishUrl });

      const response = await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenResult.token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();

        // If this is a build/runtime error with details or logs, store it for the UI to handle
        // This includes both 400 (build errors) and 500 (supervisor/runtime errors)
        if (errorData.details || errorData.logs) {
          // Combine details and logs so the agent gets the full picture
          const logText = errorData.logs
            ? errorData.logs.map((log: any) => log.message || log).join('\n')
            : '';
          const errorDetails = [errorData.details, logText].filter(Boolean).join('\n\n') || 'Unknown error';

          setBuildErrorDetails(appId, {
            error: errorData.error || 'Publish failed',
            details: errorDetails,
            exitCode: errorData.exitCode
          });

          logger.info('publish.error.build-error-stored', {
            appId,
            error: errorData.error,
            status: response.status,
            hasDetails: !!errorData.details,
            hasLogs: !!errorData.logs,
            exitCode: errorData.exitCode
          });
        }

        throw new Error(errorData.error || `Publish failed: ${response.status}`);
      }

      const result = await response.json();

      // Store the commit hash from the response for retry functionality
      if (result.commitHash) {
        setLastPublishedCommitHash(appId, result.commitHash);
      }

      // Step 3: Create deployment record via app service (secure, trusted service)
      // Only if archive was created successfully
      if (result.success && result.commitHash) {
        try {
          logger.info('publish.creating-deployment', {
            appId,
            commitHash: result.commitHash.substring(0, 7),
          });

          const deploymentResponse = await appFetch(`/api/apps/${appId}/deployments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              gitHash: result.commitHash,
              ...(dnsUpdateConsent === undefined ? {} : { dnsUpdateConsent }),
            }),
          });

          if (!deploymentResponse.ok) {
            const deploymentError = await deploymentResponse.json().catch(() => ({
              error: 'Failed to create deployment',
            }));

            logger.warn('publish.deployment-creation-failed', {
              appId,
              status: deploymentResponse.status,
              error: deploymentError.error,
            });
            // Don't throw - archive was created successfully, deployment is secondary
          } else {
            const deploymentData = await deploymentResponse.json();
            result.deployment = deploymentData;

            logger.info('publish.deployment-created', {
              appId,
              deploymentId: deploymentData.deploymentId,
              status: deploymentData.status,
            });
          }
        } catch (deploymentError) {
          logger.warn('publish.deployment-creation-error', {
            appId,
            error: deploymentError instanceof Error ? deploymentError.message : String(deploymentError),
          });
          // Don't throw - archive was created successfully
        }
      }

      return { result, commitHash: result.commitHash };
    },
    onSuccess: async (data, variables) => {
      // PRODUCTION FLOW: Deployment tracking with polling
      if (data.result.deployment?.deploymentId) {
        setDeploymentInProgressId(variables.appId, data.result.deployment.deploymentId);

        // Invalidate deployments queries to trigger immediate refetch with polling
        await queryClient.invalidateQueries({
          queryKey: ['deployments', variables.appId],
          refetchType: 'active',
        });

        // Fire-and-forget: wait for terminal state then dispatch snapshot event.
        // Must not block onSuccess — callers awaiting mutateAsync would otherwise
        // be held for up to 5 minutes.
        void waitForDeploymentComplete(variables.appId, data.result.deployment.deploymentId)
          .then(function dispatchSnapshot(succeeded) {
            if (succeeded && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('publish-snapshot-request', {
                detail: {
                  appId: variables.appId,
                  deploymentId: data.result.deployment.deploymentId,
                  commitHash: data.result.commitHash || data.commitHash,
                },
              }));
            }
          });

        // Note: isPublishing stays true - AppPublish.tsx useEffect handles clearing it when deployment completes
        return;
      }

      // LOCAL DEV FLOW: Instant publish, no deployment tracking
      if (data.result.published) {
        await handleLocalDevPublishSuccess(
          variables.appId,
          data.result.commitHash || data.commitHash,
          queryClient,
          setLastPublishedCommitHash,
          setIsPublishing,
          setPublishSuccess,
          fetchSite,
          fetchSitesList
        );

        if (typeof window !== 'undefined' && (data.result.commitHash || data.commitHash)) {
          window.dispatchEvent(new CustomEvent('publish-snapshot-request', {
            detail: {
              appId: variables.appId,
              deploymentId: undefined,
              commitHash: data.result.commitHash || data.commitHash,
            },
          }));
        }

        return;
      }

      useDevelopPageStore.getState().setFirstPublishDeployPending(variables.appId, false);
    },
    onError: (error, variables) => {
      if (error instanceof AuthDismissedError) return;
      useDevelopPageStore.getState().setFirstPublishDeployPending(variables.appId, false);
      useDevelopPageStore.getState().setShowFirstPublishCongrats(variables.appId, false);
      logger.error('publish.error', {
        appId: variables.appId,
        error: error.message,
      });
    },
  });
}
