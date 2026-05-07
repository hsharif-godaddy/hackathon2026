import { useMemo } from 'react';

import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';

/**
 * Publish sync state result
 *
 * INVARIANT: isInSync === (changesSincePublish === 0 && !hasNeverBeenPublished && !isError)
 * Callers may derive isInSync locally to avoid trusting this field.
 */
export interface PublishSyncState {
  /**
   * True when the current HEAD matches the most recent deployed commit.
   * Derived from: changesSincePublish === 0 && !hasNeverBeenPublished && !isError
   */
  isInSync: boolean;
  /** Number of commits since the last successful deployment */
  changesSincePublish: number;
  /** True when either deployments or git history is loading */
  isLoading: boolean;
  /**
   * True when the app has never been deployed.
   * Only valid when isLoading is false - while loading, this may be true even for published apps.
   */
  hasNeverBeenPublished: boolean;
  /** True when either query failed - sync state is unknown */
  isError: boolean;
}

/**
 * Options for usePublishSyncState hook
 */
export interface UsePublishSyncStateOptions {
  appId: string | undefined;
  enabled?: boolean;
}

/**
 * Hook to calculate how many changes have been made since the last publish.
 *
 * Compares the most recent deployed commit hash against the current git history
 * to determine sync state.
 *
 * @param options - Configuration options
 * @param options.appId - App ID (required)
 * @param options.enabled - Whether the hook should be enabled (default: true)
 * @returns PublishSyncState object with isInSync, changesSincePublish, and isLoading
 *
 * @example
 * ```tsx
 * const { isInSync, changesSincePublish, isLoading } = usePublishSyncState({
 *   appId: 'app-123',
 * });
 *
 * if (isInSync) {
 *   return <span>Up to date</span>;
 * }
 * return <span>{changesSincePublish} changes since last publish</span>;
 * ```
 */
export function usePublishSyncState(
  options: UsePublishSyncStateOptions
): PublishSyncState {
  const { appId, enabled = true } = options;

  const {
    data: deploymentsData = [],
    isLoading: isDeploymentsLoading,
    isError: isDeploymentsError,
  } = useDeploymentsQuery({
    appId: appId ?? '',
    enabled: enabled && !!appId,
    limit: 20,
  });

  const {
    data: gitHistoryData,
    isLoading: isGitHistoryLoading,
    isError: isGitHistoryError,
  } = useGitHistoryQuery({
    appId: appId ?? '',
    enabled: enabled && !!appId,
  });

  const result = useMemo((): PublishSyncState => {
    const allCommits = gitHistoryData?.commits || [];
    const isLoading = isDeploymentsLoading || isGitHistoryLoading;
    const isError = isDeploymentsError || isGitHistoryError;

    // If either query failed, return error state - sync status is unknown
    if (isError) {
      return {
        isInSync: false,
        changesSincePublish: 0,
        isLoading,
        hasNeverBeenPublished: false,
        isError: true,
      };
    }

    // Find the most recent successful deployment
    const mostRecentDeployment = deploymentsData.find(
      (d) => d.status === DeploymentStatus.DEPLOYED
    );

    // If no successful deployment exists, app has never been published
    // Note: while loading, deploymentsData may be empty even for published apps
    if (!mostRecentDeployment) {
      return {
        isInSync: false,
        changesSincePublish: 0,
        isLoading,
        hasNeverBeenPublished: !isLoading,
        isError: false,
      };
    }

    // Find the index of the deployed commit in the commit list
    // Commits are ordered newest to oldest (index 0 = most recent)
    const deployedCommitIndex = allCommits.findIndex(
      (c) => c.hash === mostRecentDeployment.gitHash
    );

    // If deployed commit not found in current history, treat as out of sync
    // This can happen if the deployment hash is very old and not in the loaded history
    if (deployedCommitIndex === -1) {
      logger.warn('publish-sync-state.commitHashNotFound', {
        appId,
        deployedGitHash: mostRecentDeployment.gitHash,
        loadedCommitCount: allCommits.length,
      });
      return {
        isInSync: false,
        changesSincePublish: allCommits.length,
        isLoading,
        hasNeverBeenPublished: false,
        isError: false,
      };
    }

    // Changes since publish = number of commits before the deployed commit index
    // Index 0 = newest, so if deployed commit is at index 0, there are 0 changes
    const changesSincePublish = deployedCommitIndex;

    return {
      isInSync: changesSincePublish === 0,
      changesSincePublish,
      isLoading,
      hasNeverBeenPublished: false,
      isError: false,
    };
  }, [deploymentsData, gitHistoryData, isDeploymentsLoading, isGitHistoryLoading, isDeploymentsError, isGitHistoryError]);

  return result;
}
