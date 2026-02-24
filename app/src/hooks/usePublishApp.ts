import { useMutation, useQueryClient } from '@tanstack/react-query';

import { dynamicApiConfigService } from '@/config/dynamic-api';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { appFetch } from '@/lib/gasket-config';
import { regenerateToken } from '@/lib/jwt-regeneration';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { useSiteStore } from '@/stores/useSiteStore';

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
  // Store published commit hash for unpublished changes tracking
  setLastPublishedCommitHash(appId, commitHash);

  // Clear publishing state immediately (no deployment polling in local dev)
  setIsPublishing(appId, false);

  // Refetch site from DB to get fresh data
  // LegacyControlPlaneAdapter.mapToSiteInfo() automatically computes variants from published_url
  // published_url is already in DB (set during app creation with coming soon page)
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
    // Still show success alert even if refetch fails
    setPublishSuccess(appId, true);
  }

  // Invalidate git history and secrets diff to reflect the completed sync
  await queryClient.invalidateQueries({
    queryKey: ['git-history', appId],
    refetchType: 'active'
  });
  await queryClient.invalidateQueries({
    queryKey: ['secretsDiff', appId],
    refetchType: 'active'
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
  const queryClient = useQueryClient();
  const setLastPublishedCommitHash = useDevelopPageStore((state) => state.setLastPublishedCommitHash);
  const setDeploymentInProgressId = useDevelopPageStore((state) => state.setDeploymentInProgressId);
  const setBuildErrorDetails = useDevelopPageStore((state) => state.setBuildErrorDetails);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishSuccess = useDevelopPageStore((state) => state.setPublishSuccess);
  const fetchSite = useSiteStore((state) => state.fetchSite);
  const fetchSitesList = useSitesStore((state) => state.fetchSite);
  const { data: isSecretsSyncEnabled } = useSwitchboard('appbuilder-settings-secrets');

  return useMutation<PublishResult, Error, PublishParams>({
    mutationFn: async ({ appId }) => {

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

      // Regenerate JWT with fresh permissions before publish
      logger.info('publish.regenerate-token', { appId });
      const tokenResult = await regenerateToken({ siteId: appId, force: true });

      // Get agent URL for this site
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);

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
      }
    },
    onError: (error, variables) => {
      logger.error('publish.error', {
        appId: variables.appId,
        error: error.message,
      });
    },
  });
}
