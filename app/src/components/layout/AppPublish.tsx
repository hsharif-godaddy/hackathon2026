'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useTranslations } from '@/hooks/useTranslations';
import Button from '@ux/button';
import text from '@ux/text';
import Collapsible from '@ux/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { Separator } from '@/lib/shadcn/separator';

import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';
import { usePublishApp } from '@/hooks/usePublishApp';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { useIsLoading, useStreamingState } from '@/stores/useStreamingConversationStore';
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { logger } from '@/lib/request-context';
import { hasBeenPublished } from '@/utils/site';
import { ChatTab } from '@/app/develop/components/types';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import Tag from '@ux/tag';
import SinglePlanUpgradeContainer from '@/app/develop/components/SinglePlanUpgradeContainer';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility'

export default function AppPublish({ location }: { location?: string }) {
  const intl = useIntl();
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [showAiroPlusPaywall, setShowAiroPlusPaywall] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);
  const setDeploymentsRefetch = useDevelopPageStore((state) => state.setDeploymentsRefetch);
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);
  const { data: isPublishButtonEnabled } = useSwitchboard('appbuilder-publish-button');
  const { data: isAiroPlusPaywallEnabled } = useSwitchboard('appbuilder-airoplus-paywall');

  const { showPaywall } = usePaywallEligibility(currentAppId);
  // Get publish state for current app
  const isPublishing = useDevelopPageStore(
    (state) => currentAppId && state.publishStates[currentAppId]
      ? state.publishStates[currentAppId].isPublishing
      : false
  );

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
    data: gitCommits = [],
    isLoading: isLoadingGitHistory,
  } = useGitHistoryQuery({
    appId: currentAppId || '',
    enabled: queryEnabled,
  });

  const mostRecentDeployment = deployments[0];

  // Check if deployment is in progress (not in terminal state)
  const isDeploymentInProgress = mostRecentDeployment &&
    ![DeploymentStatus.DEPLOYED, DeploymentStatus.FAILED].includes(mostRecentDeployment.status as DeploymentStatus);
  const currentCommitHash = gitCommits[0]?.hash;
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

    // Set active tab to history
    setActiveChatTab(ChatTab.HISTORY);

    // Navigate to develop page with history tab
    router.push(`/develop/${currentAppId}?tab=history`, { scroll: false });
  }, [currentAppId, setActiveChatTab, router]);

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
  // - Initial loading (deployments or git history)
  // - Publishing request in progress (before deployment shows up)
  // - Any deployment is in progress (not in terminal state)
  // - A conversation is in progress (AI is actively processing)
  // - Current commit is already successfully deployed (nothing new to publish)
  //   Note: Button remains enabled if deployment failed, allowing retry
  const isButtonDisabled = isLoading || isLoadingGitHistory || isPublishing || isDeploymentInProgress || isConversationInProgress || isCurrentCommitDeployed;

  const publishWidget = isFirstTimePublishing ? 'app_first_publish' : 'app_publish';

  // Calculate changes since last published
  const lastDeployedCommit = deployments.find(d => d.status === DeploymentStatus.DEPLOYED);
  const lastDeployedHash = lastDeployedCommit?.gitHash;
  const lastDeployedIndex = lastDeployedHash ? gitCommits.findIndex(c => c.hash === lastDeployedHash) : -1;
  // If no deployment exists (lastDeployedIndex === -1), all commits are unpublished
  // Otherwise, unpublished count is the number of commits before the last deployed one
  const unpublishedCount = lastDeployedIndex === -1 ? gitCommits.length : lastDeployedIndex;
  const lastDeployedDate = lastDeployedCommit?.updatedAt ? new Date(lastDeployedCommit.updatedAt) : null;

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

  const handlePublish = async (open: boolean) => {
    if (isAiroPlusPaywallEnabled && showPaywall && open) { // TODO: check to make sure entitlemnet is not granted already before showing the paywall
      setShowAiroPlusPaywall(true);
    } else {
      setOpen(open);
    }
  }

  return (
    <>
    {showAiroPlusPaywall && (
      <SinglePlanUpgradeContainer
        onClose={() => {
          setShowAiroPlusPaywall(false);
          
          // TODO: poll for entitlement. If entitlement is granted, call handlePublish with skipPaywall: true. else hold off 
          // TODO: While waiting, show a loading spinner and disable the publish button. For now, just call handlePublish with  showPaywall: false.
          setOpen(true);
        }}
      />
    )}
    <Popover open={open} onOpenChange={handlePublish}>
      <PopoverTrigger asChild>
        <Button
          id="tour-publish-button"
          className='!bg-ai !font-normal !border-none'
          design='primary'
          data-partial='gradientAiro'
          data-eid={generateClickEID(`${location}.header.${publishWidget}`)}
          disabled={isButtonDisabled}
          text={isPublishing || isDeploymentInProgress
            ? t('builder_publish_button_publishing')
            : t('builder_publish_button')
          }
        />
      </PopoverTrigger>
      <PopoverContent align='end' className='w-[400px] p-6'>
        <div className='flex flex-col gap-4'>
          {/* Collapsible Changes Header */}
            <Collapsible
              id='publish-changes'
              title={changesTitle}
            >
              <div className='mt-2 space-y-2'>
                {unpublishedCount > 0 && (
                  <>
                    <text.h5 size={0}>{t('builder_publish_unpublished_title')}</text.h5>
                    <div className='flex items-center gap-1'>
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
                  <div className='space-y-2'>
                    {deployments.filter(d => d.status === DeploymentStatus.DEPLOYED).slice(0, 5).map((deployment, index) => {
                      const deploymentDate = new Date(deployment.updatedAt);
                      const isMostRecent = index === 0;

                      // Calculate number of commits in this deployment
                      // Find the index of this deployment's commit in the git history
                      const deploymentCommitIndex = gitCommits.findIndex(c => c.hash === deployment.gitHash);

                      // Find the index of the next older deployment's commit
                      const nextDeployment = deployments.filter(d => d.status === DeploymentStatus.DEPLOYED)[index + 1];
                      const nextDeploymentCommitIndex = nextDeployment
                        ? gitCommits.findIndex(c => c.hash === nextDeployment.gitHash)
                        : gitCommits.length;

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
                        <div key={deployment.id} className='space-y-1'>
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

          <Separator />
          <Button
            className='!bg-ai w-full'
            design='primary'
            data-partial='gradientAiro'
            data-eid={generateClickEID(`${location}.header.${publishWidget}`)}
            disabled={isButtonDisabled}
            onClick={handleDeploy}
          >
            {isPublishing || isDeploymentInProgress
              ? t('builder_publish_button_publishing')
              : t('builder_publish_button')
            }
          </Button>

          <text.p emphasis='passive' size={0}>
            {t('builder_publish_beta_message')}
          </text.p>
        </div>
      </PopoverContent>
    </Popover>
  </>
  )
}

