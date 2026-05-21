'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import AlertIcon from '@ux/icon/alert';
import CheckmarkIcon from '@ux/icon/checkmark';
import ChevronRightIcon from '@ux/icon/chevron-right';
import CloudUploadIcon from '@ux/icon/cloud-upload';
import CommentsIcon from '@ux/icon/comments';
import HistoryIcon from '@ux/icon/history';
import InlineEditIcon from '@ux/icon/inline-edit';
import WindowNewIcon from '@ux/icon/window-new';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';
import TextLockup from '@ux/text-lockup';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types';
import { FEEDBACK_ID } from '@/components/feedback/utils';
import { SWITCHBOARD_APPBUILDER_GO_LIVE_FEATURE } from '@/config/switchboard-flags';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { useDnsConflictGate } from '@/hooks/useDnsConflictGate';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';
import { useIsHistoryDisabled } from '@/hooks/useIsHistoryDisabled';
import { usePaywallModal } from '@/hooks/usePaywallModal';
import { usePublishApp } from '@/hooks/usePublishApp';
import { usePublishComplianceGate } from '@/hooks/usePublishComplianceGate';
import { useSecretsDiff } from '@/hooks/useSecretsDiff';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { JourneyTracker } from '@/lib/journeyTracker';
import { shipAnalyticsLog } from '@/lib/logging';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { openPostPublishFeatureSelectionInChat } from '@/lib/post-publish-feature-selection';
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
import { generateClickEID, logAiroHQEvent, logClickEvent } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';
import { timeAgo } from '@/utils/time';

function publishTriggerClickEid(surfaceLocation: string, firstTime: boolean): string {
  const widget = firstTime ? 'app_first_publish' : 'app_publish';
  if (surfaceLocation === 'develop.chat_toolbar') {
    return `develop.chat_toolbar.${widget}`;
  }
  return `${surfaceLocation}.header.${widget}`;
}

function publishSubmitClickEid(surfaceLocation: string): string {
  if (surfaceLocation === 'develop.chat_toolbar') {
    return 'develop.chat_toolbar.publish_submit';
  }
  return 'develop.header.publish_submit';
}

function PublishFailedMessage({
  onFix,
  onRetry,
  isFix,
  growl = false,
}: {
  onFix: () => void;
  onRetry: () => void;
  isFix: boolean;
  growl?: boolean;
}) {
  const t = useTranslations();
  const handler = isFix ? onFix : onRetry;
  const buttonText = isFix
    ? t('builder_publish_fix_in_chat')
    : t('builder_common_try_again');
  const button = (
    <button
      type='button'
      className='underline cursor-pointer text-inherit'
      data-testid='publish-failed-action'
      onClick={() => void handler()}
    >
      {buttonText}
    </button>
  );
  if (growl) {
    return button;
  }
  return <span>{t('builder_publish_failed_inline')} {button}</span>;
}

export default function AppPublish({ location = 'develop' }: { location?: string }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [publishResult, setPublishResult] = useState<'success' | 'failed' | null>(null);
  const [isFixingBuildError, setIsFixingBuildError] = useState(false);
  const openRef = useRef(false);
  const prevAppIdRef = useRef<string | null>(null);
  const prevPublishingRef = useRef(false);
  const lastHandledPublishPopoverRequestRef = useRef<{ appId: string | null; nonce: number }>({ appId: null, nonce: 0 });
  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop');
  const { setActiveChatTab, setActiveSettingsSection } = useChatTabs();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges);
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange);
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange);
  const clickContext = useMemo(
    () => (currentAppId ? { appId: currentAppId } : undefined),
    [currentAppId],
  );
  const { isDisabled: isHistoryDisabled } = useIsHistoryDisabled(currentAppId || '');
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);
  const setDeploymentsRefetch = useDevelopPageStore((state) => state.setDeploymentsRefetch);
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal);

  const handlePublishFeedbackClick = useCallback((origin: string) => {
    logClickEvent(`${location}.header.publish_feedback`, clickContext)();
    try {
      localStorage.removeItem(`airo-feedback-shown:${FEEDBACK_ID}`);
    } catch {
      // storage unavailable
    }
    openFeedbackModal(FEEDBACK_ID, origin);
  }, [clickContext, location, openFeedbackModal]);

  const isPublishButtonEnabled = useSwitchboard('appbuilder-publish-button') === true;
  const publishFlagsEnabled = isPublishButtonEnabled && isDevelopPage;
  const isSecretsEnabled = useSwitchboard('appbuilder-settings-secrets');
  const isPostPublishFeatureSelectionEnabled = useSwitchboard('appbuilder-post-publish-feature-selection');
  const isGoLiveFeatureEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_GO_LIVE_FEATURE) === true;
  const isTopLevelDomainEnabled = useSwitchboard('appbuilder-domain-top-level');

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
  const buildErrorDetails = useDevelopPageStore(
    (state) => state.publishStates?.[currentAppId]?.buildErrorDetails ?? null
  );
  const prevBuildErrorDetailsRef = useRef(buildErrorDetails);
  const showFirstPublishCongrats = useDevelopPageStore(
    (state) =>
      currentAppId && state.publishStates[currentAppId]
        ? Boolean(state.publishStates[currentAppId].showFirstPublishCongrats)
        : false
  );
  const publishPopoverRequestNonce = useDevelopPageStore(
    (state) => state.publishStates?.[currentAppId]?.publishPopoverRequestNonce ?? 0,
  );

  const publishMutation = usePublishApp();

  const site = useSiteStore((state) => currentAppId ? state.getSite(currentAppId) : null);
  const { isBlocked: isPublishComplianceBlocked, blockReason: publishComplianceBlockReason } =
    usePublishComplianceGate(site, { enabled: publishFlagsEnabled });
  const fqdn = resolveSiteFqdn(site) || '';
  const { modal: dnsConflictModal, runGate } = useDnsConflictGate({ appId: currentAppId, site });

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

  const showPostPublishFeatureSelection = useDevelopPageStore((state) =>
    currentAppId && state.publishStates?.[currentAppId]
      ? Boolean(state.publishStates[currentAppId].showPostPublishFeatureSelection)
      : false,
  );

  const isPreLaunchCheckFromPublishDisabled =
    isPublishingOrDeploying || isConversationInProgress || showPostPublishFeatureSelection;

  openRef.current = open;

  const openPopover = useCallback(() => {
    if (openRef.current) {
      logger.info('app-publish.popover.open-skipped.already-open', { appId: currentAppId, location });
      return;
    }
    setOpen(true);
  }, [currentAppId, location]);

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
      lastHandledPublishPopoverRequestRef.current = { appId: null, nonce: 0 };
      return;
    }
    if (prevAppIdRef.current === currentAppId) return;
    const hadPreviousApp = prevAppIdRef.current !== null;
    prevAppIdRef.current = currentAppId;
    lastHandledPublishPopoverRequestRef.current = { appId: currentAppId, nonce: publishPopoverRequestNonce };
    if (hadPreviousApp) {
      setPublishResult(null);
      setOpen(false);
      setIsFixingBuildError(false);
    }
  }, [currentAppId, publishPopoverRequestNonce]);

  useEffect(() => {
    // This effect intentionally depends on `publishPopoverRequestNonce` so each
    // store increment is consumed exactly once by the active AppPublish instance.
    // The app-switch effect above must run first (same-commit effect order) to
    // seed `lastHandledPublishPopoverRequestRef` before this effect evaluates.
    if (!currentAppId || publishPopoverRequestNonce <= 0) return;
    if ((isMobile && !isChatToolbar) || (!isMobile && isChatToolbar)) return;
    const lastHandled = lastHandledPublishPopoverRequestRef.current;
    if (lastHandled.appId !== currentAppId) {
      logger.info('app-publish.popover.nonce-skipped.app-mismatch', {
        appId: currentAppId,
        lastHandledAppId: lastHandled.appId,
        location,
        nonce: publishPopoverRequestNonce,
      });
      lastHandledPublishPopoverRequestRef.current = { appId: currentAppId, nonce: publishPopoverRequestNonce };
      return;
    }
    if (publishPopoverRequestNonce <= lastHandled.nonce) return;
    lastHandledPublishPopoverRequestRef.current = { appId: currentAppId, nonce: publishPopoverRequestNonce };
    openPopover();
  }, [currentAppId, isChatToolbar, isMobile, openPopover, publishPopoverRequestNonce]);

  useEffect(() => {
    if (!currentAppId || !showFirstPublishCongrats) return;
    setOpen(false);
    setPublishResult(null);
  }, [currentAppId, showFirstPublishCongrats]);

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

    logClickEvent(publishSubmitClickEid(location), {
      ...(clickContext ?? {}),
      ...(isFirstTimePublishing ? { firstPublish: true } : {}),
    })();

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

    try {
      const gateResult = await runGate();
      if (!gateResult.proceed) {
        return;
      }
      if (gateResult.consent !== undefined) {
        setOpen(false);
      }

      clearPublishStatus(currentAppId);
      setIsPublishing(currentAppId, true);

      await publishMutation.mutateAsync({
        appId: currentAppId,
        dnsUpdateConsent: gateResult.consent,
      });
      JourneyTracker.current()?.trackMilestone('site_published', { appId: currentAppId })

      // Note: usePublishApp hook polls until deployment appears and triggers refetch
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('app-publish.deploy.error', {
        appId: currentAppId,
        error: errorMessage,
      });
      useDevelopPageStore.getState().setFirstPublishDeployPending(currentAppId, false);
      setPublishError(currentAppId, true);
      setIsPublishing(currentAppId, false);
    }
  }, [clickContext, currentAppId, site, location, isFirstTimePublishing, isPublishComplianceBlocked, publishComplianceBlockReason, setPublishError, setIsPublishing, clearPublishStatus, publishMutation, runGate]);

  const handleFixBuildError = useCallback(() => {
    if (!currentAppId || !buildErrorDetails) return;

    logger.info('app-publish.fix-build-error', {
      message: 'User clicked fix build error',
      appId: currentAppId,
    });

    setIsFixingBuildError(true);
    setActiveChatTab(ChatTab.CHAT);

    window.postMessage({
      type: 'build-error-fix-request',
      appId: currentAppId,
      errorMessage: buildErrorDetails.error,
      errorDetails: buildErrorDetails.details,
      exitCode: buildErrorDetails.exitCode,
    }, window.location.origin);
  }, [currentAppId, buildErrorDetails, setActiveChatTab]);

  const prevIsConversationInProgressRef = useRef(isConversationInProgress);

  useEffect(() => {
    const wasProcessing = prevIsConversationInProgressRef.current;
    prevIsConversationInProgressRef.current = isConversationInProgress;

    if (wasProcessing && !isConversationInProgress && isFixingBuildError) {
      setIsFixingBuildError(false);
      setPublishResult(null);
    }
  }, [isConversationInProgress, isFixingBuildError]);

  useEffect(() => {
    if (!isFixingBuildError || isConversationInProgress) return;
    const timeout = setTimeout(() => {
      setIsFixingBuildError(false);
      setPublishResult(null);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [isFixingBuildError, isConversationInProgress]);

  useEffect(() => {
    const wasPublishing = prevPublishingRef.current;
    prevPublishingRef.current = !!isPublishingOrDeploying;

    const prevBuildErrorDetails = prevBuildErrorDetailsRef.current;
    prevBuildErrorDetailsRef.current = buildErrorDetails;
    const buildErrorDetailsUpdated = prevBuildErrorDetails !== buildErrorDetails;

    if ((!wasPublishing && !buildErrorDetailsUpdated) || isPublishingOrDeploying) return;

    const failed = publishError || mostRecentDeployment?.status === DeploymentStatus.FAILED;
    const succeeded = mostRecentDeployment?.status === DeploymentStatus.DEPLOYED;

    if (!failed && !succeeded) return;

    const outcome: 'success' | 'failed' = failed ? 'failed' : 'success';

    if (outcome === 'success') {
      if (!wasPublishing) return;

      if (
        currentAppId &&
        useDevelopPageStore.getState().getPublishState(currentAppId).showFirstPublishCongrats
      ) {
        setOpen(false);
        setPublishResult(null);
        return;
      }

      // Open feedback modal directly to NPS step after publish.
      // Placed after showFirstPublishCongrats guard to prevent simultaneous modals.
      // openFeedbackModal internally guards against re-showing via localStorage.
      openFeedbackModal(FEEDBACK_ID, 'First publish', 'feedback');

      if (openRef.current) {
        setPublishResult(outcome);
        return;
      }

      Growl.addGrowlMessage({
        id: 'app-publish-success',
        title: t('builder_publish_success_title'),
        children: (
          <Box orientation='vertical' gap='md' className='min-w-[200px]'>
            <p>{t('builder_publish_message_live')}</p>
            <Separator className='opacity-20' />
            <Box orientation='vertical' gap='sm' data-partial='inverted'>
              {fqdn ? (
                <Button
                  design='primary'
                  type='button'
                  as='external'
                  size='sm'
                  text={t('builder_publish_button_visit')}
                  stretch
                  // `as='external'` still renders a <button> here (no href). onClick + window.open
                  // avoids growl CSS overrides on elements with href attribute.
                  onClick={() => {
                    logClickEvent(`${location}.growl.visit_site`, clickContext)();
                    window.open(fqdn, '_blank', 'noopener,noreferrer');
                  }}
                />
              ) : null}
              <Button
                design='secondary'
                type='button'
                size='sm'
                text={t('builder_settings_nav_feedback')}
                stretch
                onClick={() => {
                  logClickEvent(`${location}.growl.publish_feedback`, clickContext)();
                  Growl.removeGrowlMessage('app-publish-success');
                  handlePublishFeedbackClick('Publish Growl');
                }}
              />
            </Box>
          </Box>
        ),
        emphasis: 'success'
      });
      return;
    }

    if (openRef.current) {
      if (wasPublishing) setPublishResult(outcome);
      return;
    }

    Growl.removeGrowlMessage('app-publish-failed');
    Growl.addGrowlMessage({
      id: 'app-publish-failed',
      title: t('builder_publish_failed_title'),
      children: (
        <p>
          <PublishFailedMessage
            onFix={() => { Growl.removeGrowlMessage('app-publish-failed'); handleFixBuildError(); }}
            onRetry={() => { Growl.removeGrowlMessage('app-publish-failed'); void handleDeploy(); }}
            isFix={!!buildErrorDetails}
            growl
          />
        </p>
      ),
      emphasis: 'critical',
    });
  }, [currentAppId, isPublishingOrDeploying, mostRecentDeployment?.status, publishError, buildErrorDetails, fqdn, t, handleDeploy, handleFixBuildError, handlePublishFeedbackClick, location, openFeedbackModal]);

  /**
   * Navigate to version history tab
   */
  const handleViewHistory = useCallback(() => {
    // Keep popover open while viewing history
    setActiveChatTab(ChatTab.HISTORY);
  }, [setActiveChatTab]);

  const handleViewDomain = useCallback(() => {
    logClickEvent(`${location}.header.publish_domain_edit`, clickContext)();
    setOpen(false);
    if (isTopLevelDomainEnabled) {
      handleViewModeChange(ViewMode.DOMAIN, hasUnsavedChanges);
      if (isMobile) handleMobileModeChange(MobileMode.PREVIEW);
    } else {
      setActiveSettingsSection(SettingsSection.DOMAIN);
      setActiveChatTab(ChatTab.SETTINGS);
    }
  }, [clickContext, handleMobileModeChange, handleViewModeChange, hasUnsavedChanges, isMobile, isTopLevelDomainEnabled, location, setActiveChatTab, setActiveSettingsSection, setOpen]);

  const handleGoLiveInChat = useCallback(() => {
    if (!currentAppId || !isGoLiveFeatureEnabled || isPreLaunchCheckFromPublishDisabled) {
      return;
    }
    openPostPublishFeatureSelectionInChat(currentAppId);
    shipAnalyticsLog('go_live.chat.opened_from_publish_popover', { appId: currentAppId });
    setOpen(false);
  }, [currentAppId, isGoLiveFeatureEnabled, isPreLaunchCheckFromPublishDisabled, setOpen]);

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
    !isPublishButtonEnabled ||
    !currentAppId ||
    !site?.agent_url ||
    isPublishComplianceBlocked;

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

    logClickEvent(
      publishTriggerClickEid(location, isFirstTimePublishing),
      clickContext,
    )();

    // Refetch git history and secrets diff to ensure counts are accurate
    refetchGitHistory();
    void refetchSecretsDiff();

    // Check paywall and either show modal or open popover
    await checkAndShowPaywall(async () => {
      openPopover();
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
      {dnsConflictModal}
      <Popover open={open} onOpenChange={handlePublish}>
        <PopoverTrigger asChild>
          <Button
            id="tour-publish-button"
            design='primary'
            size='sm'
            data-partial='componentAiro'
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
                    className='[&_#AppPublishDomainEdit]:!pe-[80px] [&_#AppPublishDomainEdit]:truncate'
                  />
                  {!isFirstTimePublishing && (
                    <div className='absolute end-[5px] top-1/2 -translate-y-1/2 flex gap-0.5 items-center'>
                      <IconButton
                        icon={<InlineEditIcon className='size-2' />}
                        onClick={handleViewDomain}
                        label={t('builder_common_edit')}
                        size='sm'
                        inverted
                        showLabelWhenActive={false}
                      />
                      <IconButton
                        icon={<WindowNewIcon className='size-2' />}
                        onClick={() => {
                          logClickEvent(`${location}.header.publish_domain_copy`, clickContext)();
                          window.open(fqdn, '_blank', 'noopener,noreferrer');
                        }}
                        label={t('builder_common_open_link')}
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

            {isPostPublishFeatureSelectionEnabled === true &&
              isGoLiveFeatureEnabled &&
              currentAppId &&
              !isFirstTimePublishing && (
              <Button
                className='w-full'
                design='secondary'
                size='sm'
                data-eid={generateClickEID(`${location}.header.publish_go_live_chat`)}
                onClick={handleGoLiveInChat}
                disabled={isPreLaunchCheckFromPublishDisabled}
                text={t('builder_publish_prelaunch_check_button', {}, 'Check SEO and Health')}
              />
            )}

            {isAiroSubdomain(fqdn) && !isFirstTimePublishing && (
              <Button
                className='w-full'
                design='secondary'
                size='sm'
                onClick={handleViewDomain}
                text={t('builder_common_custom_domain_button')}
              />
            )}

            {(publishResult === null || isFixingBuildError) && (
              <Button
                className='w-full'
                design='primary'
                size='sm'
                data-partial='componentAiro'
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

            {publishResult === 'failed' && !isFixingBuildError && (
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
                  <PublishFailedMessage
                    onFix={() => { setOpen(false); handleFixBuildError(); }}
                    onRetry={() => void handleDeploy()}
                    isFix={!!buildErrorDetails}
                  />
                </text.span>
              </Box>
            )}

            {isPublishingOrDeploying && publishResult === null && (
              <Button
                type='button'
                className='w-full'
                onClick={() => handlePublishFeedbackClick('Publish Popover')}
                icon={<CommentsIcon className='size-2' />}
                size='sm'
              >
                {t('builder_settings_nav_feedback')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
