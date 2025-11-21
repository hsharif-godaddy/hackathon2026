import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appFetch } from '@/lib/gasket-config';
import { appService } from '@/services/AppService';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import type { AiroDeployment } from '@/lib/mgmt-airo';
import { useSwitchboard } from '@/hooks/useSwitchboard';

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
 * React Query hook for publishing an app
 *
 * Handles fetching the latest commit hash if not provided and making the publish request.
 * Stores the last published commit hash in the store for retry functionality.
 *
 * After successful publish:
 * - Sets deploymentInProgressId in store to track the new deployment
 * - useDeploymentsQuery detects this ID and starts polling
 * - Polling continues until deployment status is 'deployed' or 'failed'
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
  const { data: isSecretsSyncEnabled } = useSwitchboard('appbuilder-settings-secrets');

  return useMutation<PublishResult, Error, PublishParams>({
    mutationFn: async ({ appId, commitHash }) => {
      let hashToPublish = commitHash;

      // If no commit hash provided, fetch the latest from git history
      if (!hashToPublish) {
        logger.debug('publish.git-history.start', { appId });

        const historyData = await appService.getGitHistory(appId);
        const currentCommit = historyData.commits?.[0];

        if (!currentCommit?.hash) {
          throw new Error('No commit found in git history');
        }

        hashToPublish = currentCommit.hash;

        logger.info('publish.git-history.success', {
          appId,
          commitHash: hashToPublish?.substring(0, 7),
          commitMessage: currentCommit.message
        });
      }

      // Store the commit hash for retry functionality
      setLastPublishedCommitHash(appId, hashToPublish);

      // Sync secrets from preview to publish before publishing
      logger.info('publish.secrets-sync.start', {
        appId,
        source: 'preview',
        destination: 'publish'
      });

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

          if (syncResponse.ok) {
            const syncResult = await syncResponse.json();
            logger.info('publish.secrets-sync.success', {
              appId,
              added: syncResult.operations?.added || 0,
              updated: syncResult.operations?.updated || 0,
              deleted: syncResult.operations?.deleted || 0
            });
          } else {
            // Log warning but don't fail publish - secrets sync is non-critical
            logger.warn('publish.secrets-sync.failed', {
              appId,
              status: syncResponse.status,
              message: 'Secrets sync failed but continuing with publish'
            });
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

      const response = await appFetch(`/api/apps/${appId}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
        }

        throw new Error(errorData.error || `Publish failed: ${response.status}`);
      }

      const result = await response.json();

      return { result, commitHash: hashToPublish };
    },
    onSuccess: async (data, variables) => {
      logger.info('publish.success', {
        appId: variables.appId,
        commitHash: data.commitHash.substring(0, 7),
        deploymentId: data.result.deployment?.deploymentId,
      });

      // Set deployment ID in store to trigger polling in useDeploymentsQuery
      if (data.result.deployment?.deploymentId) {
        setDeploymentInProgressId(variables.appId, data.result.deployment.deploymentId);

        logger.info('publish.deployment-tracking-started', {
          appId: variables.appId,
          deploymentId: data.result.deployment.deploymentId,
        });
      }

      // Invalidate deployments queries to trigger immediate refetch with polling
      await queryClient.invalidateQueries({
        queryKey: ['deployments', variables.appId],
        refetchType: 'active',
      });
    },
    onError: (error, variables) => {
      logger.error('publish.error', {
        appId: variables.appId,
        error: error.message,
      });
    },
  });
}
