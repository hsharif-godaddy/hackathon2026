import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { usePublishApp } from '@/hooks/usePublishApp';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import type { Site } from '@/stores/useSitesStore';
import { useIsLoading, useStreamingState } from '@/stores/useStreamingConversationStore';

/**
 * Custom hook for handling publish functionality in domain settings empty state
 * 
 * Consolidates publish mutation, status checks, and disable logic specifically
 * for the first-time publish scenario (unpublished sites). Simpler than the main
 * AppPublish logic since it doesn't need to check if current commit is deployed.
 * 
 * @param currentAppId - The current app ID
 * @param site - The site object
 * @returns Object containing handlePublish, isPublishDisabled, and publishState
 * 
 * @example
 * ```tsx
 * const { handlePublish, isPublishDisabled, publishState } = usePublishForDomain(appId, site);
 * 
 * <EmptyStateCard
 *   ctaLabel={publishState.isPublishing ? "Publishing..." : "Publish Now"}
 *   onCtaClick={handlePublish}
 *   ctaDisabled={isPublishDisabled}
 * />
 * ```
 */
export function usePublishForDomain(currentAppId: string | null, site: Site | null) {
  const publishMutation = usePublishApp();
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);
  const getPublishState = useDevelopPageStore((state) => state.getPublishState);

  // Check if a conversation is in progress (AI is actively processing)
  const isConversationLoading = useIsLoading();
  const streamingState = useStreamingState();
  const isConversationInProgress = isConversationLoading || streamingState !== 'idle';

  // Check deployments to see if one is in progress
  const {
    data: deployments = [],
    isLoading: isLoadingDeployments,
  } = useDeploymentsQuery({
    appId: currentAppId || '',
    enabled: !!currentAppId && !!site?.agent_url,
    includeJobData: true,
    limit: 1,
  });

  const mostRecentDeployment = deployments[0];
  const isDeploymentInProgress = mostRecentDeployment && 
    ![DeploymentStatus.DEPLOYED, DeploymentStatus.FAILED].includes(mostRecentDeployment.status as DeploymentStatus);

  const publishState = currentAppId ? getPublishState(currentAppId) : {
    isPublishing: false,
    publishError: false,
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
  };

  const handlePublish = async () => {
    if (!currentAppId || !site?.agent_url) {
      if (currentAppId) {
        setPublishError(currentAppId, true);
      }
      return;
    }

    clearPublishStatus(currentAppId);
    setIsPublishing(currentAppId, true);

    try {
      await publishMutation.mutateAsync({ appId: currentAppId });
    } catch (error) {
      setPublishError(currentAppId, true);
      setIsPublishing(currentAppId, false);
    }
  };

  // Button is disabled when:
  // - Initial loading (deployments)
  // - Publishing request in progress (before deployment shows up)
  // - Any deployment is in progress (not in terminal state)
  // - A conversation is in progress (AI is actively processing)
  // Note: No need to check if current commit is deployed since this hook
  // is only used for unpublished sites (first-time publish scenario)
  const isPublishDisabled = isLoadingDeployments || 
    publishState.isPublishing || 
    isDeploymentInProgress || 
    isConversationInProgress;

  return {
    handlePublish,
    isPublishDisabled,
    publishState,
  };
}

