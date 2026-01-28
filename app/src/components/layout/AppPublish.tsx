'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import Alert from '@ux/alert';
import Button from '@ux/button';
import Collapsible from '@ux/collapsible';
import CloudUploadIcon from '@ux/icon/cloud-upload';
import Tag from '@ux/tag';
import text from '@ux/text';

import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';
import { usePaywallModal } from '@/hooks/usePaywallModal';
import { usePublishApp } from '@/hooks/usePublishApp';
import { useResponsive } from '@/hooks/useResponsive';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { Separator } from '@/lib/shadcn/separator';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { useIsLoading, useStreamingState } from '@/stores/useStreamingConversationStore';
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

export default function AppPublish({ location }: { location?: string }) {
  const intl = useIntl();
  const t = useTranslations();
  const { isMobile } = useResponsive();
  const [open, setOpen] = useState(false);
  const [entitlementsPollingFailed, setEntitlementsPollingFailed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);
  const setDeploymentsRefetch = useDevelopPageStore((state) => state.setDeploymentsRefetch);

  // Switchboard flags
  const { data: isPublishButtonEnabled } = useSwitchboard('appbuilder-publish-button');
  const { data: isAiroPlusPaywallEnabled } = useSwitchboard('appbuilder-airoplus-paywall');

  // Use shared paywall modal hook
  const { checkAndShowPaywall, PaywallModal, isPolling, isPaywallLoading } = usePaywallModal({
    appId: currentAppId,
    source: 'publish',
    onPurchaseSuccess: async () => {
      // Open publish modal after successful purchase
      setOpen(true);
      setEntitlementsPollingFailed(false);
    },
  });

  // Get publish state for current app
  const isPublishing = useDevelopPageStore(
    (state) => currentAppId && state.publishStates[currentAppId]
      ? state.publishStates[currentAppId].isPublishing
      : false
  );

  // Get last published commit hash from store (for local dev unpublished count)
  // Falls back to localStorage if store value is null (e.g., after page refresh)
  const storeLastPublishedCommitHash = useDevelopPageStore(
    (state) => currentAppId && state.publishStates[currentAppId]
      ? state.publishStates[currentAppId].lastPublishedCommitHash
      : null
  );
  const lastPublishedCommitHash = useMemo(() => {
    if (storeLastPublishedCommitHash) return storeLastPublishedCommitHash;
    if (typeof window === 'undefined' || !currentAppId) return null;
    return localStorage.getItem(`airo-last-published-commit-${currentAppId}`);
  }, [storeLastPublishedCommitHash, currentAppId]);

  const publishMutation = usePublishApp();
  const isDevelopPage = pathname?.includes('/develop');

  const site = useSiteStore((state) => currentAppId ? state.getSite(currentAppId) : null);

  // Check if a conversation is in progress (AI is actively processing)
  const isConversationLoading = useIsLoading();
  const streamingState = useStreamingState();
  const isConversationInProgress = isConversationLoading || streamingState !== 'idle';

  const queryEnabled = isPublishButtonEnabled && isDevelopPage && !!currentAppId && !!site?.agent_url;

  const {
    data: deployments = [],
    isLoading,
    refetch,
  } = useDeploymentsQuery({
    appId: currentAppId || '',
    enabled: queryEnabled,
    includeJobData: true,
    limit: 6,
  });

  const {
    data: gitHistoryData,
    isLoading: isLoadingGitHistory,
    refetch: refetchGitHistory,
  } = useGitHistoryQuery({
    appId: currentAppId || '',
    enabled: queryEnabled,
  });
  const currentCommit = gitHistoryData?.currentCommit

  const mostRecentDeployment = deployments[0];

  // Check if deployment is in progress (not in terminal state)
  const isDeploymentInProgress = mostRecentDeployment &&
    ![DeploymentStatus.DEPLOYED, DeploymentStatus.FAILED].includes(mostRecentDeployment.status as DeploymentStatus);
  // Use actual current commit (HEAD) instead of latest commit (commits[0])
  // Falls back to commits[0] for backward compatibility with old backends
  // Use memoizedGitCommits below after useMemo
  const currentCommitHash = currentCommit || gitHistoryData?.commits?.[0]?.hash;
  const isCurrentCommitDeployed = currentCommitHash &&
    mostRecentDeployment?.gitHash === currentCommitHash &&
    mostRecentDeployment?.status === DeploymentStatus.DEPLOYED;

  useEffect(() => {
    if (!queryEnabled || !currentAppId) return;

    // If no deployment exists yet, ensure publishing state is cleared
    if (!mostRecentDeployment) {
      setIsPublishing(currentAppId, false);
      return;
    }

    const status = mostRecentDeployment.status;

    if (isDeploymentInProgress) {
      setIsPublishing(currentAppId, true);
      setPublishError(currentAppId, false);
    } else {
      setIsPublishing(currentAppId, false);

      if (status === DeploymentStatus.FAILED) {
        setPublishError(currentAppId, true);
      } else {
        setPublishError(currentAppId, false);
      }
    }
  }, [mostRecentDeployment, isDeploymentInProgress, currentAppId, queryEnabled, setIsPublishing, setPublishError]);

  // Check if this is first-time publishing
  const isFirstTimePublishing = !hasBeenPublished(site);

  // Internal deploy function (called after QA gate passes or is skipped)
  const handleDeploy = useCallback(async () => {
    setOpen(false);

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
      // Publish with latest commit (mutation will fetch git history and store commit hash internally)
      await publishMutation.mutateAsync({ appId: currentAppId });

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

  /**
   * Navigate to version history tab
   */
  const handleViewHistory = useCallback(() => {
    if (!currentAppId) return;
    router.push(`/develop/${currentAppId}?tab=history`, { scroll: false });
  }, [currentAppId, router]);

  // Register deployments refetch function in store for retry functionality
  useEffect(() => {
    if (currentAppId) {
      setDeploymentsRefetch(currentAppId, refetch);

      return () => {
        setDeploymentsRefetch(currentAppId, null);
      };
    }
  }, [currentAppId, refetch, setDeploymentsRefetch]);

  // Calculate changes since last published
  // Must be before early return to satisfy React hooks rules
  const lastDeployedCommit = deployments.find(d => d.status === DeploymentStatus.DEPLOYED);

  // Memoize gitCommits array to avoid dependency changes on every render
  const memoizedGitCommits = useMemo(() => gitHistoryData?.commits || [], [gitHistoryData?.commits]);

  // Calculate unpublished count with multiple fallbacks:
  // 1. If we have deployment record with gitHash, find its index in commits
  // 2. If lastPublishedCommitHash matches any commit in history, use that index
  // 3. If no match found, all commits are unpublished
  const unpublishedCount = useMemo(() => {
    if (!memoizedGitCommits.length) return 0;

    // Production: use deployment record
    if (lastDeployedCommit?.gitHash) {
      const idx = memoizedGitCommits.findIndex(c => c.hash === lastDeployedCommit.gitHash);
      return idx === -1 ? memoizedGitCommits.length : idx;
    }

    // Local dev: find the last published commit in history
    if (lastPublishedCommitHash) {
      const idx = memoizedGitCommits.findIndex(c => c.hash === lastPublishedCommitHash);
      return idx === -1 ? memoizedGitCommits.length : idx;
    }

    // No publish record - all commits are unpublished
    return memoizedGitCommits.length;
  }, [memoizedGitCommits, lastDeployedCommit?.gitHash, lastPublishedCommitHash]);

  const lastDeployedDate = lastDeployedCommit?.updatedAt ? new Date(lastDeployedCommit.updatedAt) : null;

  if (!isPublishButtonEnabled || !isDevelopPage || !currentAppId || !site?.agent_url) {
    return null;
  }

  // Button is disabled when:
  // - Initial loading (deployments or git history)
  // - Polling entitlements after purchase
  // - Entitlements polling failed
  // - Paywall eligibility is being checked
  // Note: Publishing, deployment, conversation in progress, and current commit deployed are now shown as warnings in the modal
  const isButtonDisabled = isLoading || isLoadingGitHistory || isPolling || entitlementsPollingFailed || isPaywallLoading;

  const publishWidget = isFirstTimePublishing ? 'app_first_publish' : 'app_publish';

  const formattedDate = lastDeployedDate ? intl.formatDate(lastDeployedDate, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }) : '';

  const changesTitle = (
    <>
      <text.h3 size={1}>{t('builder_publish_changes_title')}</text.h3>
      {lastDeployedDate && (
        <text.p size={0} emphasis='passive'>
          {t('builder_publish_changes_since', { count: unpublishedCount, date: formattedDate })}
        </text.p>
      )}
    </>
  );

  // Determine which status alert to show (priority order)
  const getPublishStatusAlert = () => {
    if (isPublishing) {
      return (
        <Alert emphasis="warning">
          {t('builder_publish_in_progress_warning')}
        </Alert>
      );
    }

    if (isDeploymentInProgress) {
      return (
        <Alert emphasis="warning">
          {t('builder_publish_deployment_in_progress_warning')}
        </Alert>
      );
    }

    if (isConversationInProgress) {
      return (
        <Alert emphasis="warning">
          {t('builder_publish_conversation_warning')}
        </Alert>
      );
    }

    if (isCurrentCommitDeployed) {
      return (
        <Alert emphasis="info">
          {t('builder_publish_no_changes_info')}
        </Alert>
      );
    }

    return null;
  };

  // Determine button text based on current state
  const getPublishButtonText = () => {
    if (isPublishing || isDeploymentInProgress) {
      return t('builder_publish_button_publishing');
    }

    if (isCurrentCommitDeployed) {
      return t('builder_publish_button_republish');
    }

    return t('builder_publish_button');
  };

  const handlePublish = async (shouldOpen: boolean) => {
    if (!shouldOpen) {
      // Just close the popover
      setOpen(false);
      return;
    }

    // Reset polling failure state when attempting to publish
    setEntitlementsPollingFailed(false);
    // Refetch git history to ensure commit count is accurate
    refetchGitHistory();

    // Check paywall and either show modal or open popover
    await checkAndShowPaywall(async () => {
      setOpen(true);
    });
  }

  return (
    <>
      <PaywallModal />
      <Popover open={open} onOpenChange={handlePublish}>
        <PopoverTrigger asChild>
          <Button
            id="tour-publish-button"
            design='primary'
            size='sm'
            data-partial='componentAiro'
            data-eid={generateClickEID(`${location}.header.${publishWidget}`)}
            disabled={isButtonDisabled}
            icon={<CloudUploadIcon />}
            text={isMobile ? undefined : getPublishButtonText()}
          />
        </PopoverTrigger>
        <PopoverContent align='end' className='w-[400px] p-3'>
          <div className='flex flex-col gap-2'>
            {/* Collapsible Changes Header */}
            <Collapsible
              id='publish-changes'
              title={changesTitle}
            >
              <div className='mt-1 space-y-1'>
                {unpublishedCount > 0 && (
                  <>
                    <text.h5 size={0}>{t('builder_publish_unpublished_title')}</text.h5>
                    <div className='flex items-center gap-0.5'>
                      <Button design='inline' onClick={handleViewHistory}>
                        {t('builder_publish_changes_count', { count: unpublishedCount })}
                      </Button>
                      <text.p>
                        {deployments.length > 0
                          ? t('builder_publish_since_current')
                          : t('builder_publish_first_publish')
                        }
                      </text.p>
                    </div>
                  </>
                )}

                {deployments.length > 0 && (
                  <div className='space-y-1'>
                    {deployments.filter(d => d.status === DeploymentStatus.DEPLOYED).slice(0, 5).map((deployment, index) => {
                      const deploymentDate = new Date(deployment.updatedAt);
                      const isMostRecent = index === 0;

                      // Calculate number of commits in this deployment
                      // Find the index of this deployment's commit in the git history
                      const deploymentCommitIndex = memoizedGitCommits.findIndex(c => c.hash === deployment.gitHash);

                      // Find the index of the next older deployment's commit
                      const nextDeployment = deployments.filter(d => d.status === DeploymentStatus.DEPLOYED)[index + 1];
                      const nextDeploymentCommitIndex = nextDeployment
                        ? memoizedGitCommits.findIndex(c => c.hash === nextDeployment.gitHash)
                        : memoizedGitCommits.length;

                      // Count commits between this deployment and the next older one
                      const commitCount = deploymentCommitIndex >= 0 && nextDeploymentCommitIndex >= 0
                        ? nextDeploymentCommitIndex - deploymentCommitIndex
                        : 1;

                      const deploymentFormattedDate = intl.formatDate(deploymentDate, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      });

                      return (
                        <div key={deployment.id} className='space-y-0.5'>
                          <div className='flex items-center justify-between'>
                            <text.h5 size={0} emphasis='passive'>
                              {deploymentFormattedDate}
                            </text.h5>
                            {isMostRecent && (
                              <Tag emphasis='info'>{t('builder_publish_current_tag')}</Tag>
                            )}
                          </div>
                          <text.p size={0} emphasis='passive'>
                            {t('builder_publish_changes_count', { count: commitCount })}
                          </text.p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Collapsible>

            {/* Status alert (shows most relevant state) */}
            {getPublishStatusAlert()}

            <Separator />

            <Button
              className='w-full'
              design='primary'
              size='sm'
              data-partial='componentAiro'
              data-eid={generateClickEID(`${location}.header.${publishWidget}`)}
              disabled={isButtonDisabled || isPublishing || isDeploymentInProgress || isConversationInProgress}
              onClick={handleDeploy}
            >
              {getPublishButtonText()}
            </Button>

            {!isAiroPlusPaywallEnabled && (
              <text.p emphasis='passive' size={0}>
                {t('builder_publish_beta_message')}
              </text.p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
