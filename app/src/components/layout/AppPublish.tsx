'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import Button from '@ux/button';

import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { useGitHistoryStore } from '@/stores/useGitHistoryStore';
import { usePublishApp } from '@/hooks/usePublishApp';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { useIsLoading, useStreamingState } from '@/stores/useStreamingConversationStore';
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { logger } from '@/lib/request-context';
import { hasBeenPublished } from '@/utils/site';

export default function AppPublish({ location }: { location?: string }) {
  const pathname = usePathname();
  const { currentAppId, selectedCommit, isSelectingCommit } = useDevelopPageStore();
  const getPublishState = useDevelopPageStore((state) => state.getPublishState);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);
  const setDeploymentsRefetch = useDevelopPageStore((state) => state.setDeploymentsRefetch);
  const { data: isPublishButtonEnabled } = useSwitchboard('appbuilder-publish-button');
  
  // Track restore operations and get commits from the git history store
  const isRestoring = useGitHistoryStore((state) => state.isRestoring(currentAppId || ''));
  const getCommits = useGitHistoryStore((state) => state.getCommits);
  const refreshGitHistory = useGitHistoryStore((state) => state.refreshGitHistory);
  const loadGitHistory = useGitHistoryStore((state) => state.loadGitHistory);

  // Get publish state for current app
  const publishState = currentAppId ? getPublishState(currentAppId) : {
    isPublishing: false,
    publishError: false,
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
  };
  const { isPublishing } = publishState;

  const publishMutation = usePublishApp();
  const isDevelopPage = pathname?.includes('/develop');
  
  const site = useSiteStore((state) => currentAppId ? state.getSite(currentAppId) : null);

  // Check if a conversation is in progress
  const isConversationLoading = useIsLoading();
  const streamingState = useStreamingState();
  const isConversationInProgress = isConversationLoading || streamingState !== 'idle';
  
  // Track previous conversation state to detect completion
  const prevConversationInProgressRef = useRef(isConversationInProgress);
  
  // Track previous commit selection state to detect restoration to main
  const prevIsSelectingCommitRef = useRef(isSelectingCommit);
  
  // Track previous restore state to detect when restore completes
  const prevIsRestoringRef = useRef(isRestoring);

  const queryEnabled = isPublishButtonEnabled && isDevelopPage && !!currentAppId && !!site?.agent_url;

  const {
    data: deployments = [],
    isLoading,
    refetch,
  } = useDeploymentsQuery({
    appId: currentAppId || '',
    enabled: queryEnabled,
    includeJobData: true,
    limit: 5,
  });

  const mostRecentDeployment = deployments[0];
  
  // Check if deployment is in progress (not in terminal state)
  const isDeploymentInProgress = mostRecentDeployment && 
    !['deployed', 'failed'].includes(mostRecentDeployment.status);

  // Get git history to check if current commit is already successfully deployed
  // Only disable if the commit is deployed successfully (not failed)
  // Use store instead of hook to ensure we get updates from all sources (conversations, restores, etc.)
  const gitCommits = currentAppId ? getCommits(currentAppId) : [];
  const currentCommitHash = gitCommits[0]?.hash;
  const isCurrentCommitDeployed = currentCommitHash && 
    mostRecentDeployment?.gitHash === currentCommitHash && 
    mostRecentDeployment?.status === 'deployed';

  // Load git history on mount if not already loaded
  useEffect(() => {
    if (!queryEnabled || !currentAppId || gitCommits.length > 0) return;
    loadGitHistory(currentAppId);
  }, [queryEnabled, currentAppId, gitCommits.length, loadGitHistory]);

  // Refresh git history when conversation completes to detect new commits
  useEffect(() => {
    if (!queryEnabled || !currentAppId) return;
    
    // Detect transition from conversation in-progress to idle
    const wasInProgress = prevConversationInProgressRef.current;
    const isNowIdle = !isConversationInProgress;
    
    // When conversation completes (was in progress, now idle), refresh git history
    // to check if new commits were created during the conversation
    if (wasInProgress && isNowIdle) {
      refreshGitHistory(currentAppId);
    }
    
    // Update ref for next render
    prevConversationInProgressRef.current = isConversationInProgress;
  }, [isConversationInProgress, queryEnabled, currentAppId, refreshGitHistory]);

  // Refresh git history when user returns to main branch (restores to latest version)
  useEffect(() => {
    if (!queryEnabled || !currentAppId) return;
    
    // Detect transition from selecting commit to selection complete
    const wasSelecting = prevIsSelectingCommitRef.current;
    const selectionComplete = !isSelectingCommit;
    
    // When commit selection completes and selectedCommit is null, user returned to main
    // Refresh git history to update the current commit hash for publish button state
    if (wasSelecting && selectionComplete && selectedCommit === null) {
      logger.info('app-publish.git-history.refresh-after-restore', {
        appId: currentAppId,
        message: 'Refreshing git history after returning to main branch'
      });
      refreshGitHistory(currentAppId);
    }
    
    // Update ref for next render
    prevIsSelectingCommitRef.current = isSelectingCommit;
  }, [isSelectingCommit, selectedCommit, queryEnabled, currentAppId, refreshGitHistory]);

  // Refresh git history when commit restore completes (creates new commit from old one)
  useEffect(() => {
    if (!queryEnabled || !currentAppId) return;
    
    // Detect transition from restoring to restore complete
    const wasRestoring = prevIsRestoringRef.current;
    const restoreComplete = !isRestoring;
    
    // When restore completes, a new commit was created
    // Refresh git history to update the current commit hash for publish button state
    if (wasRestoring && restoreComplete) {
      logger.info('app-publish.git-history.refresh-after-commit-restore', {
        appId: currentAppId,
        message: 'Refreshing git history after restoring commit (new commit created)'
      });
      refreshGitHistory(currentAppId);
    }
    
    // Update ref for next render
    prevIsRestoringRef.current = isRestoring;
  }, [isRestoring, queryEnabled, currentAppId, refreshGitHistory]);

  useEffect(() => {
    if (!mostRecentDeployment || !queryEnabled || !currentAppId) return;

    const status = mostRecentDeployment.status;

    if (isDeploymentInProgress) {
      setIsPublishing(currentAppId, true);
      setPublishError(currentAppId, false);
    } else {
      setIsPublishing(currentAppId, false);

      if (status === 'failed') {
        setPublishError(currentAppId, true);
      } else {
        setPublishError(currentAppId, false);
      }
    }
  }, [mostRecentDeployment, isDeploymentInProgress, currentAppId, queryEnabled, setIsPublishing, setPublishError]);

  // Check if this is first-time publishing
  const isFirstTimePublishing = !hasBeenPublished(site);

  const handleDeploy = useCallback(async () => {
    if (!currentAppId || !site?.agent_url) {
      logger.error('app-publish.deploy.error', {
        appId: currentAppId,
        error: 'No app ID or agent URL available',
      });
      if (currentAppId) {
        setPublishError(currentAppId, true);
      }
      return;
    }

    // Log publish button click event
    const airoHQTask = isFirstTimePublishing
      ? 'builder_project_first_published'
      : 'builder_project_published';

    logAiroHQEvent({
      category: 'click',
      recommendation_task: airoHQTask,
      recommendation_type: 'publish',
      recommendation_id: currentAppId,
    })();

    clearPublishStatus(currentAppId);
    setIsPublishing(currentAppId, true);

    try {
      logger.info('app-publish.deploy.start', { appId: currentAppId });

      // Publish with latest commit (mutation will fetch git history and store commit hash internally)
      const { result, commitHash } = await publishMutation.mutateAsync({ appId: currentAppId });

      logger.info('app-publish.deploy.triggered', {
        appId: currentAppId,
        commitHash: commitHash.substring(0, 7),
        result
      });

      // Note: usePublishApp hook polls until deployment appears and triggers refetch
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('app-publish.deploy.error', {
        appId: currentAppId,
        error: errorMessage,
      });
      setPublishError(currentAppId, true);
      setIsPublishing(currentAppId, false);
    }
  }, [currentAppId, site, isFirstTimePublishing, setPublishError, setIsPublishing, clearPublishStatus, publishMutation]);

  // Register deployments refetch function in store for retry functionality
  useEffect(() => {
    if (currentAppId) {
      setDeploymentsRefetch(currentAppId, refetch);
      
      return () => {
        setDeploymentsRefetch(currentAppId, null);
      };
    }
  }, [currentAppId, refetch, setDeploymentsRefetch]);

  if (!isPublishButtonEnabled || !isDevelopPage || !currentAppId || !site?.agent_url) {
    return null;
  }

  // Button is disabled when:
  // - Initial loading
  // - Publishing request in progress (before deployment shows up)
  // - Any deployment is in progress (not in terminal state)
  // - A conversation is in progress (AI is actively processing)
  // - Current commit is already successfully deployed (nothing new to publish)
  //   Note: Button remains enabled if deployment failed, allowing retry
  const isButtonDisabled = isLoading || isPublishing || isDeploymentInProgress || isConversationInProgress || isCurrentCommitDeployed;

  const publishWidget = isFirstTimePublishing ? 'app_first_publish' : 'app_publish';

  return (
    <Button
      className="!bg-ai"
      design="primary"
      data-partial="gradientAiro"
      data-eid={generateClickEID(`${location}.header.${publishWidget}`)}
      disabled={isButtonDisabled}
      onClick={handleDeploy}
    >
      {isPublishing || isDeploymentInProgress ? 'Publishing...' : 'Publish'}
    </Button>
  );
}

