'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import Button from '@ux/button';

import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { usePublishApp } from '@/hooks/usePublishApp';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { generateClickEID } from '@/utils/instrumentation';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { logger } from '@/lib/request-context';

export default function AppPublish({ location }: { location?: string }) {
  const pathname = usePathname();
  const { currentAppId } = useDevelopPageStore();
  const getPublishState = useDevelopPageStore((state) => state.getPublishState);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);
  const setDeploymentsRefetch = useDevelopPageStore((state) => state.setDeploymentsRefetch);
  const { featureFlags } = useSwitchboard();

  // Get publish state for current app
  const publishState = currentAppId ? getPublishState(currentAppId) : {
    isPublishing: false,
    publishError: false,
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
  };
  const { isPublishing } = publishState;

  const publishMutation = usePublishApp();

  const isPublishButtonEnabled = featureFlags['appbuilder-publish-button'] ?? false;
  const isDevelopPage = pathname?.includes('/develop');
  
  const site = useSiteStore((state) => currentAppId ? state.getSite(currentAppId) : null);

  const queryEnabled = isPublishButtonEnabled && isDevelopPage && !!currentAppId && !!site?.agent_url;

  const {
    data: deployments = [],
    isLoading,
    refetch,
  } = useDeploymentsQuery({
    appId: currentAppId || '',
    enabled: queryEnabled,
    includeJobData: true,
    limit: 1,
    // Poll with progressive intervals if deployment is in progress
    shouldPoll: (data) => {
      const latestDeployment = data?.[0];
      logger.info('deployments-query.polling.shouldPoll', {
        appId: currentAppId,
        deploymentId: latestDeployment?.id,
        status: latestDeployment?.status,
      });
      return latestDeployment && !['deployed', 'failed'].includes(latestDeployment.status);
    },
  });

  const mostRecentDeployment = deployments[0];
  
  // Check if deployment is in progress (not in terminal state)
  const isDeploymentInProgress = mostRecentDeployment && 
    !['deployed', 'failed'].includes(mostRecentDeployment.status);

  useEffect(() => {
    if (!mostRecentDeployment || !queryEnabled || !currentAppId) return;

    const status = mostRecentDeployment.status;

    if (isDeploymentInProgress) {
      logger.debug('app-publish.status.in-progress', {
        appId: currentAppId,
        status,
        deploymentId: mostRecentDeployment.id,
      });
      setIsPublishing(currentAppId, true);
      setPublishError(currentAppId, false);
    } else {
      logger.info('app-publish.status.terminal', {
        appId: currentAppId,
        status,
        deploymentId: mostRecentDeployment.id,
      });
      setIsPublishing(currentAppId, false);

      if (status === 'failed') {
        setPublishError(currentAppId, true);
      } else {
        setPublishError(currentAppId, false);
      }
    }
  }, [mostRecentDeployment, isDeploymentInProgress, currentAppId, queryEnabled, setIsPublishing, setPublishError]);

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
  }, [currentAppId, site?.agent_url, setPublishError, setIsPublishing, clearPublishStatus, publishMutation]);

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
  const isButtonDisabled = isLoading || isPublishing || isDeploymentInProgress;

  return (
    <Button
      className="!bg-ai"
      design="primary"
      data-partial="gradientAiro"
      data-eid={generateClickEID(`${location}.header.app_publish`)}
      disabled={isButtonDisabled}
      onClick={handleDeploy}
    >
      {isPublishing || isDeploymentInProgress ? 'Publishing...' : 'Publish'}
    </Button>
  );
}

