import { useMutation, useQueryClient } from '@tanstack/react-query';

import { dynamicApiConfigService } from '@/config/dynamic-api';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { appFetch } from '@/lib/gasket-config';
import { regenerateToken } from '@/lib/jwt-regeneration';
import { logger } from '@/lib/request-context';
import { appService } from '@/services/AppService';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
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
  commitHash?: string;
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
  fetchSite: (appId: string, forceRefresh: boolean) => Promise<any>
) {
  // Store published commit hash for unpublished changes tracking
  setLastPublishedCommitHash(appId, commitHash);

  // Clear publishing state immediately (no deployment polling in local dev)
  setIsPublishing(appId, false);

  // Refetch site from DB to get fresh data
  // LegacyControlPlaneAdapter.mapToSiteInfo() automatically computes variants from published_url
  // published_url is already in DB (set during app creation with coming soon page)
  try {
    await fetchSite(appId, true);
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

  // Invalidate git history to refresh commit list
  await queryClient.invalidateQueries({ 
    queryKey: ['git-history', appId], 
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
  const { data: isSecretsSyncEnabled } = useSwitchboard('appbuilder-settings-secrets');

  return useMutation<PublishResult, Error, PublishParams>({
    mutationFn: async ({ appId, commitHash }) => {
      let hashToPublish = commitHash;

      // If no commit hash provided, fetch the current commit (HEAD) from git history
      if (!hashToPublish) {
        const historyData = await appService.getGitHistory(appId);
        // Use actual current commit (HEAD) instead of latest commit (commits[0])
        // This ensures we publish what's actually checked out, not necessarily the tip
        const currentCommitHash = historyData.currentCommit || historyData.commits?.[0]?.hash;

        if (!currentCommitHash) {
          throw new Error('No commit found in git history');
        }

        hashToPublish = currentCommitHash;
      }

      // Store the commit hash for retry functionality
      setLastPublishedCommitHash(appId, hashToPublish);

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
        body: JSON.stringify({ commitHash: hashToPublish }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // If this is a build error (400 status with details), store it for the UI to handle
        if (response.status === 400 && errorData.details) {
          setBuildErrorDetails(appId, {
            error: errorData.error || 'Build failed',
            details: errorData.details,
            exitCode: errorData.exitCode
          });

          // Automatically send build error logs to agent
          logger.info('publish.build-error.auto-send-to-agent', {
            appId,
            error: errorData.error,
            hasDetails: !!errorData.details,
            exitCode: errorData.exitCode
          });

          // Dispatch event to automatically send build error to agent
          // The develop page listens for this event and handles the error fix request
          if (typeof window !== 'undefined') {
            window.postMessage({
              type: 'build-error-fix-request',
              appId,
              errorMessage: errorData.error || 'Build failed',
              errorDetails: errorData.details,
              exitCode: errorData.exitCode,
              autoSend: true // Flag to indicate this was auto-triggered
            }, window.location.origin);
          }
        }

        throw new Error(errorData.error || `Publish failed: ${response.status}`);
      }

      const result = await response.json();

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

      return { result, commitHash: hashToPublish };
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
          fetchSite
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
