'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import AlertIcon from '@ux/icon/alert';
import CheckmarkIcon from '@ux/icon/checkmark';
import ChevronRightIcon from '@ux/icon/chevron-right';
import CloudUploadIcon from '@ux/icon/cloud-upload';
import HistoryIcon from '@ux/icon/history';
import InlineEditIcon from '@ux/icon/inline-edit';
import WindowNewIcon from '@ux/icon/window-new';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';
import TextLockup from '@ux/text-lockup';

import IconButton from '@/app/develop/components/IconButton';
import { ChatTab, SettingsSection } from '@/app/develop/components/types';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';
import { useIsHistoryDisabled } from '@/hooks/useIsHistoryDisabled';
import { usePaywallModal } from '@/hooks/usePaywallModal';
import { usePublishApp } from '@/hooks/usePublishApp';
import { usePublishComplianceGate } from '@/hooks/usePublishComplianceGate';
import { useSecretsDiff } from '@/hooks/useSecretsDiff';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { getPublishLimit } from '@/lib/publish-limit';
import { logger } from '@/lib/request-context';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { Separator } from '@/lib/shadcn/separator';
import { PublishComplianceBlockReason } from '@/lib/subscription';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { useIsLoading, useStreamingState } from '@/stores/useStreamingConversationStore';
import { getPlanDisplayLabelKey } from '@/utils/credits';
import { isAiroSubdomain, resolveSiteFqdn } from '@/utils/domain';
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';
import { timeAgo } from '@/utils/time';

function PublishFailedRetryMessage({ onRetry }: { onRetry: () => void | Promise<void> }) {
  return (
    <FormattedMessage
      id='builder_publish_failed_retry'
      values={{
        retry: (chunks) => (
          <button
            type='button'
            className='underline cursor-pointer text-inherit'
            onClick={() => void onRetry()}
          >
            {chunks}
          </button>
        ),
      }}
    />
  );
}

export default function AppPublish({ location = 'develop' }: { location?: string }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [publishResult, setPublishResult] = useState<'success' | 'failed' | null>(null);
  const openRef = useRef(false);
  const prevAppIdRef = useRef<string | null>(null);
  const prevPublishingRef = useRef(false);
  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop');
  const { setActiveChatTab, setActiveSettingsSection } = useChatTabs();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const isHistoryDisabled = useIsHistoryDisabled(currentAppId || '');
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);
  const setDeploymentsRefetch = useDevelopPageStore((state) => state.setDeploymentsRefetch);

  // Switchboard flags
  // Coerce to boolean to prevent React Query errors when undefined
  const {
    data: isPublishButtonEnabled,
    isError: isPublishSwitchboardError,
  } = useSwitchboard('appbuilder-publish-button');
  const isPublishButtonEnabledFlag =
    isPublishButtonEnabled === true || isPublishSwitchboardError;
  const publishBlockedBySwitchboard =
    !isPublishSwitchboardError && !isPublishButtonEnabled;
  // Secondary flags only needed once the publish button is confirmed enabled on the develop page.
  // AppPublish is always mounted in the header, so without this guard they fire on every page load.
  const publishFlagsEnabled = isPublishButtonEnabledFlag && isDevelopPage;
  const { data: isSecretsEnabled } = useSwitchboard('appbuilder-settings-secrets', { enabled: publishFlagsEnabled });

  const isChatToolbar = location === 'develop.chat_toolbar';

  // Use shared paywall modal hook (includes publish limit check)
  const { checkAndShowPaywall, PaywallModal, isPaywallLoading, isPublishLimitLoading } = usePaywallModal({
    appId: currentAppId,
    source: 'publish',
    itc: PAYWALL_ITC.PUBLISH,
    onPurchaseSuccess: async () => {
      // Open publish modal after successful purchase
      setOpen(true);
    },
  });

  const { data: subscription } = useSubscription();
  const planName = subscription?.plan ? t(getPlanDisplayLabelKey(subscription.plan)) : '';
  const publishLimit = getPublishLimit(subscription?.plan);

  // Get publish state for current app
  const isPublishing = useDevelopPageStore(
    (state) => currentAppId && state.publishStates[currentAppId]
      ? state.publishStates[currentAppId].isPublishing
      : false
  );
  const publishError = useDevelopPageStore(
    (state) => state.publishStates?.[currentAppId]?.publishError ?? false
  );

  const publishMutation = usePublishApp();

  const site = useSiteStore((state) => currentAppId ? state.getSite(currentAppId) : null);
  const { isBlocked: isPublishComplianceBlocked, blockReason: publishComplianceBlockReason } =
    usePublishComplianceGate(site, { enabled: publishFlagsEnabled });
  const fqdn = resolveSiteFqdn(site) || '';

  // Check if a conversation is in progress (AI is actively processing)
  const isConversationLoading = useIsLoading();
  const streamingState = useStreamingState();
  const isConversationInProgress = isConversationLoading || streamingState !== 'idle';

  const queryEnabled = isPublishButtonEnabledFlag && isDevelopPage && !!currentAppId && !!site?.agent_url;

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
    isLoading: isLoadingGitHistory,
    refetch: refetchGitHistory,
  } = useGitHistoryQuery({
    appId: currentAppId || '',
    enabled: queryEnabled,
  });

  const mostRecentDeployment = deployments[0];

  // Check if deployment is in progress (not in terminal state)
  const isDeploymentInProgress = mostRecentDeployment &&
    ![DeploymentStatus.DEPLOYED, DeploymentStatus.FAILED].includes(mostRecentDeployment.status as DeploymentStatus);

  const isPublishingOrDeploying = isPublishing || isDeploymentInProgress;

  openRef.current = open;

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

  useEffect(() => {
    if (!currentAppId) {
      prevAppIdRef.current = null;
      return;
    }
    if (prevAppIdRef.current === currentAppId) return;
    const hadPreviousApp = prevAppIdRef.current !== null;
    prevAppIdRef.current = currentAppId;
    if (hadPreviousApp) {
      setPublishResult(null);
      setOpen(false);
    }
  }, [currentAppId]);

  // Check if this is first-time publishing
  const isFirstTimePublishing = !hasBeenPublished(site);

  // Internal deploy function (called after QA gate passes or is skipped)
  const handleDeploy = useCallback(async () => {
    setPublishResult(null);

    if (isPublishComplianceBlocked) {
      logger.warn('app-publish.deploy.blocked-compliance', { appId: currentAppId, publishComplianceBlockReason });
      return;
    }

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
  }, [currentAppId, site, isFirstTimePublishing, isPublishComplianceBlocked, publishComplianceBlockReason, setPublishError, setIsPublishing, clearPublishStatus, publishMutation]);

  useEffect(() => {
    const wasPublishing = prevPublishingRef.current;
    prevPublishingRef.current = !!isPublishingOrDeploying;

    if (!wasPublishing || isPublishingOrDeploying) return;

    const failed = publishError || mostRecentDeployment?.status === DeploymentStatus.FAILED;
    const succeeded = mostRecentDeployment?.status === DeploymentStatus.DEPLOYED;

    if (!failed && !succeeded) return;

    const outcome: 'success' | 'failed' = failed ? 'failed' : 'success';

    if (openRef.current) {
      setPublishResult(outcome);
      return;
    }

    if (outcome === 'success') {
      Growl.addGrowlMessage({
        id: 'app-publish-success',
        title: t('builder_publish_success_title'),
        ...(fqdn
          ? {
              children: (
                <Button
                  design='inline'
                  as='external'
                  external={true}
                  href={fqdn}
                  text={t('builder_common_open_link')}
                />
              ),
            }
          : {}),
        emphasis: 'success'
      });
      return;
    }

    Growl.addGrowlMessage({
      id: 'app-publish-failed',
      title: t('builder_publish_failed_title'),
      children: (
        <p>
          <PublishFailedRetryMessage
            onRetry={() => {
              Growl.removeGrowlMessage('app-publish-failed');
              void handleDeploy();
            }}
          />
        </p>
      ),
      emphasis: 'critical',
    });
  }, [isPublishingOrDeploying, mostRecentDeployment?.status, publishError, fqdn, t, handleDeploy]);

  /**
   * Navigate to version history tab
   */
  const handleViewHistory = useCallback(() => {
    // Keep popover open while viewing history
    setActiveChatTab(ChatTab.HISTORY);
  }, [setActiveChatTab]);

  const handleViewDomain = useCallback(() => {
    setOpen(false);
    setActiveSettingsSection(SettingsSection.DOMAIN);
    setActiveChatTab(ChatTab.SETTINGS);
  }, [setOpen, setActiveSettingsSection, setActiveChatTab]);

  // Register deployments refetch function in store for retry functionality
  useEffect(() => {
    if (currentAppId) {
      setDeploymentsRefetch(currentAppId, refetch);

      return () => {
        setDeploymentsRefetch(currentAppId, null);
      };
    }
  }, [currentAppId, refetch, setDeploymentsRefetch]);

  const lastDeployedCommit = deployments.find(d => d.status === DeploymentStatus.DEPLOYED);
  const lastDeployedDate = lastDeployedCommit?.updatedAt ? new Date(lastDeployedCommit.updatedAt) : null;

  const { refetch: refetchSecretsDiff } = useSecretsDiff({
    appId: currentAppId || '',
    enabled: queryEnabled && isSecretsEnabled === true,
  });

  if (!isDevelopPage) {
    return null;
  }

  // Button is disabled when:
  // - Initial loading (deployments or git history)
  // - Paywall eligibility is being checked
  // - Publish limit is being checked
  // Note: Publishing, deployment, conversation in progress, and current commit deployed are now shown as warnings in the modal
  const isButtonDisabled =
    isLoading ||
    isLoadingGitHistory ||
    isPaywallLoading ||
    isPublishLimitLoading ||
    publishBlockedBySwitchboard ||
    !currentAppId ||
    !site?.agent_url ||
    isPublishComplianceBlocked;

  const publishWidget = isFirstTimePublishing ? 'app_first_publish' : 'app_publish';


  // Determine which status alert to show (priority order)
  const getPublishStatusAlert = () => {
    if (isConversationInProgress) {
      return (
        <Alert emphasis="warning">
          {t('builder_publish_conversation_warning')}
        </Alert>
      );
    }

    if (isPublishComplianceBlocked) {
      return (
        <Alert emphasis="critical">
          {publishComplianceBlockReason === PublishComplianceBlockReason.SiteSuspended
            ? t('builder_manageplan_apps_publish_blocked_suspended')
            : t('builder_manageplan_apps_publish_blocked_subscription')}
        </Alert>
      );
    }

    return null;
  };

  // Determine button text: "Publish" when there are code or secret changes to publish; "Republish" only when neither.
  const getPublishButtonText = () => {
    if (isPublishingOrDeploying) {
      return t('builder_publish_button_publishing');
    }

    return t('builder_publish_button');
  };

  const handlePublish = async (shouldOpen: boolean) => {
    if (!shouldOpen) {
      setOpen(false);
      setPublishResult(null);
      return;
    }

    // Refetch git history and secrets diff to ensure counts are accurate
    refetchGitHistory();
    void refetchSecretsDiff();

    // Check paywall and either show modal or open popover
    await checkAndShowPaywall(async () => {
      setOpen(true);
    });
  }

  const getTriggerButtonIcon = () => {
    if (isPublishingOrDeploying) {
      // Spinner's rotation animation causes it to overflow the icon only button bounds, increasing its size.
      return (
        <div className='relative flex items-center justify-center'>
          <Spinner size='sm' className='absolute' />
        </div>
      );
    }
    if (isChatToolbar) return <CloudUploadIcon className="!size-2.5" />;
  };

  const lastDeployedTimeAgo = lastDeployedDate ? timeAgo(lastDeployedDate) : null;

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
            icon={getTriggerButtonIcon()}
            text={isChatToolbar || isPublishingOrDeploying ? undefined : getPublishButtonText()}
            aria-label={getPublishButtonText()}
            className="!rounded-xmd !pt-0 !pb-0 !pl-1.5 !pr-1.5 sm:!p-1 !border-none md:!border-solid"
          />
        </PopoverTrigger>
        <PopoverContent align='end' className='w-[350px] p-3'>
          <div className='flex flex-col gap-1'>
            <TextLockup
              title={t('builder_publish_popover_title')}
              size='sm'
              className='mb-1'
            >
              {isFirstTimePublishing && publishLimit !== null && publishLimit > 0 && (
                <FormattedMessage
                  id="builder_publish_plan_includes"
                  values={{
                    planName,
                    limit: publishLimit,
                  }}
                />
              )}
            </TextLockup>

            {lastDeployedDate && (
              <button
                type='button'
                onClick={handleViewHistory}
                aria-label={t('builder_publish_history')}
                className='group flex w-full items-center justify-between gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
                disabled={isHistoryDisabled}
              >
                <Box orientation='horizontal' inlineAlignChildren='center' gap='sm'>
                  <HistoryIcon />
                  <text.span as='label' size={-1}>
                    {t('builder_common_last_publish')} • {t(lastDeployedTimeAgo.key, lastDeployedTimeAgo.values)}
                  </text.span>
                </Box>
                <div
                  className='p-1 rounded-md aspect-square group-hover:bg-intents-ux-actionHovered-backgroundColor group-hover:text-intents-ux-actionHovered-foregroundColor'
                >
                  <ChevronRightIcon />
                </div>
              </button>
            )}

            {/* Status alert (shows most relevant state) */}
            {getPublishStatusAlert()}

            {/* Domain Editing */}
            {fqdn && (
              <div className='flex flex-col gap-0.5'>
                <text.label size={-1} htmlFor='AppPublishDomainEdit' as='label'>
                  {t('builder_domain_title')}
                </text.label>
                <div className='relative'>
                  <TextInput
                    label={null}
                    id='AppPublishDomainEdit'
                    value={fqdn.replace(/^https?:\/\//, '')}
                    visualSize='sm'
                    readOnly
                    disabled={isFirstTimePublishing}
                    className='[&_#AppPublishDomainEdit]:!pr-[80px] [&_#AppPublishDomainEdit]:truncate'
                  />
                  {!isFirstTimePublishing && (
                    <div className='absolute right-[5px] top-1/2 -translate-y-1/2 flex gap-0.5 items-center'>
                      <IconButton
                        icon={<InlineEditIcon className='size-2' />}
                        onClick={handleViewDomain}
                        label={t('builder_common_edit')}
                        dataEid={generateClickEID(`${location}.header.publish_domain_edit`)}
                        size='sm'
                        inverted
                        showLabelWhenActive={false}
                      />
                      <IconButton
                        icon={<WindowNewIcon className='size-2' />}
                        onClick={function openPublishDomain() {
                          window.open(fqdn, '_blank', 'noopener,noreferrer');
                        }}
                        label={t('builder_common_open_link')}
                        dataEid={generateClickEID(`${location}.header.publish_domain_copy`)}
                        size='sm'
                        inverted
                        showLabelWhenActive={false}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Explanation that domain connect/edit relies on publishing */}
            {isFirstTimePublishing && (
              <text.p as='caption' size={-1} className='mt-1'>
                {t('builder_publish_unpublished_domain_info')}
              </text.p>
            )}

            <Separator />

            {isAiroSubdomain(fqdn) && !isFirstTimePublishing && (
              <Button
                className='w-full'
                design='control'
                size='sm'
                onClick={handleViewDomain}
                text={t('builder_common_custom_domain_button')}
              />
            )}

            {publishResult === null && (
              <Button
                className='w-full'
                design='primary'
                size='sm'
                data-partial='componentAiro'
                data-eid={generateClickEID(`${location}.header.${publishWidget}`)}
                disabled={isButtonDisabled || isPublishingOrDeploying || isConversationInProgress}
                onClick={handleDeploy}
                text={getPublishButtonText()}
                icon={isPublishingOrDeploying ? <Spinner size='sm' /> : undefined}
              />
            )}

            {publishResult === 'success' && (
              <Box
                data-testid='publish-success-alert'
                orientation='horizontal'
                blockAlignChildren='center'
                inlineAlignChildren='center'
                blockPadding='sm'
                inlinePadding='sm'
                gap='sm'
              >
                <CheckmarkIcon className='text-intents-ux-feedbackHighContrastSuccess-feedbackColor' />
                <text.p as='action' size={-1}>
                  {t('builder_publish_success_title')}
                </text.p>
              </Box>
            )}

            {publishResult === 'failed' && (
              <Box
                orientation='horizontal'
                blockAlignChildren='center'
                inlineAlignChildren='center'
                blockPadding='sm'
                inlinePadding='sm'
                gap='sm'
              >
                <AlertIcon className='text-intents-ux-feedbackHighContrastCritical-feedbackColor' />
                <text.span as='action' size={-1}>
                  <PublishFailedRetryMessage onRetry={handleDeploy} />
                </text.span>
              </Box>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
