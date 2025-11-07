import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appFetch } from '@/lib/gasket-config';
import { appService } from '@/services/AppService';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import type { AiroDeployment } from '@/lib/mgmt-airo';

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
 * After successful publish, efficiently polls for the new deployment by:
 * 1. Fetching only the 4 most recent deployments (lightweight polling)
 * 2. Checking if deploymentId appears in the response
 * 3. Once found, refetches ALL matching deployments queries with fresh data
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

      const response = await appFetch(`/api/apps/${appId}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ commitHash: hashToPublish }),
      });

      if (!response.ok) {
        const errorData = await response.json();
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

      // Poll deployments endpoint until the new deployment appears
      if (data.result.deployment?.deploymentId) {
        const deploymentId = data.result.deployment.deploymentId;
        let attempts = 0;

        logger.debug('publish.polling-for-deployment', {
          appId: variables.appId,
          deploymentId,
        });

        while (true) {
          attempts++;

          // Fetch only the 4 most recent deployments for efficient polling
          const deployments = await queryClient.fetchQuery<AiroDeployment[]>({
            queryKey: ['deployments', variables.appId, 4, true],
            queryFn: async (): Promise<AiroDeployment[]> => {
              const queryParams = new URLSearchParams({
                limit: '1',
                includeJobData: 'true',
              });

              const response = await appFetch(
                `/api/apps/${variables.appId}/deployments?${queryParams.toString()}`
              );

              if (!response.ok) {
                const errorMessage = `Failed to fetch deployments: ${response.status} ${response.statusText}`;
                throw new Error(errorMessage);
              }

              const responseData = await response.json();
              return Array.isArray(responseData) ? responseData : responseData.deployments || [];
            },
          });

          // Check if our deployment appears in the recent deployments
          const hasNewDeployment = deployments.some(d => d.id === deploymentId);

          if (hasNewDeployment) {
            logger.info('publish.deployment-found', {
              appId: variables.appId,
              deploymentId,
              attempts,
            });

            // Refetch ALL deployments queries to get fresh data
            await queryClient.refetchQueries({
              queryKey: ['deployments', variables.appId],
              type: 'all', // Refetch all queries (active and inactive)
            });

            logger.debug('publish.queries-refetched', {
              appId: variables.appId,
              deploymentId,
            });
            break;
          }

          logger.debug('publish.deployment-not-found-yet', {
            appId: variables.appId,
            deploymentId,
            attempts,
          });
        }
      } else {
        // No deployment info - just refetch once
        await queryClient.refetchQueries({
          queryKey: ['deployments', variables.appId],
          type: 'all',
        });
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

