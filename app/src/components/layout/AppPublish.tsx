'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import AlertIcon from '@ux/icon/alert';
import ArrowRightIcon from '@ux/icon/arrow-right';
import CheckmarkIcon from '@ux/icon/checkmark';
import ChevronRightIcon from '@ux/icon/chevron-right';
import CloudUploadIcon from '@ux/icon/cloud-upload';
import CommentsIcon from '@ux/icon/comments';
import HistoryIcon from '@ux/icon/history';
import InlineEditIcon from '@ux/icon/inline-edit';
import ShieldCheckIcon from '@ux/icon/shield-check';
import WindowNewIcon from '@ux/icon/window-new';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';
import TextLockup from '@ux/text-lockup';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types';
import { FEEDBACK_ID } from '@/components/feedback/utils';
import PublishUpsellPopover from '@/components/layout/PublishUpsellPopover';
import SeoQualityRegressionAlert from '@/components/layout/SeoQualityRegressionAlert';
import { SWITCHBOARD_APPBUILDER_GO_LIVE_FEATURE } from '@/config/switchboard-flags';
import { useAppSsoStatus } from '@/hooks/useAppSsoStatus';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { useDnsConflictGate } from '@/hooks/useDnsConflictGate';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';
import { useIsHistoryDisabled } from '@/hooks/useIsHistoryDisabled';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { usePaywallModal } from '@/hooks/usePaywallModal';
import { usePublishApp } from '@/hooks/usePublishApp';
import { usePublishComplianceGate } from '@/hooks/usePublishComplianceGate';
import { usePublishUpsellEligibility } from '@/hooks/usePublishUpsellEligibility';
import { useSecretsDiff } from '@/hooks/useSecretsDiff';
import { useSeoQualityCheck } from '@/hooks/useSeoQualityCheck';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { useTriggerSecurityAnalysis } from '@/hooks/useTriggerSecurityAnalysis';
import { useIsUpgradePolling } from '@/hooks/useUpgradePurchase';
import { isBuilderPagePath } from '@/lib/builder-route';
import { JourneyTracker } from '@/lib/journeyTracker';
import { shipAnalyticsLog } from '@/lib/logging';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { openPostPublishFeatureSelectionInChat } from '@/lib/post-publish-feature-selection';
import { getPublishLimit } from '@/lib/publish-limit';
import { logger } from '@/lib/request-context';
import { markSettingsNotification } from '@/lib/settings-notifications-storage';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { Separator } from '@/lib/shadcn/separator';
import { PublishComplianceBlockReason } from '@/lib/subscription';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { useIsLoading, useStreamingState } from '@/stores/useStreamingConversationStore';
import { getPlanDisplayLabelKey } from '@/utils/credits';
import { isAiroSubdomain, resolveSiteFqdn } from '@/utils/domain';
import { generateClickEID, logAiroHQEvent, logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
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
  const [securityFooterDismissed, setSecurityFooterDismissed] = useState(false);
  const openRef = useRef(false);
  const prevAppIdRef = useRef<string | null>(null);
  const prevPublishingRef = useRef(false);
  const lastHandledPublishPopoverRequestRef = useRef<{ appId: string | null; nonce: number }>({ appId: null, nonce: 0 });

  const pathname = usePathname();
  const isDevelopPage = isBuilderPagePath(pathname);
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
  const { isTreatment } = usePublishUpsellEligibility();
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
  const isSecurityScanUiEnabled = useSwitchboard('appbuilder-security-scan-ui') === true;

  const isChatToolbar = location === 'develop.chat_toolbar';
  // Exactly one mounted AppPublish drives the publish popover per viewport: desktop -> header,
  // mobile -> chat toolbar. (Negation of the old skip guard this replaced:
  // `(isMobile && !isChatToolbar) || (!isMobile && isChatToolbar)`.)
  const isActivePublishInstance = isMobile === isChatToolbar;

  const isUpgradePolling = useIsUpgradePolling();
  const fetchSite = useSiteStore((state) => state.fetchSite);
  const { showPaywall } = usePaywallEligibility();
  const publishOpenAfterUpgradeAppId = usePaywallStore((state) => state.publishOpenAfterUpgradeAppId);
  const clearPublishOpenAfterUpgrade = usePaywallStore((state) => state.clearPublishOpenAfterUpgrade);
  const [pendingOpenAfterUpgrade, setPendingOpenAfterUpgrade] = useState(false);
  const [isAgentInitiatedPublish, setIsAgentInitiatedPublish] = useState(false);
  const { triggerAnalysis } = useTriggerSecurityAnalysis();
  const isSecurityAnalysisRunning = useDevelopPageStore(
    (s) => !!(s.currentAppId && s.publishStates[s.currentAppId]?.isSecurityAnalysisRunning)
  );
  // Persisted scan outcome for the current app: drives the publish-footer "completed" state.
  // Reset to null on the next publish so the footer reverts to its pre-publish message.
  const securityAnalysisResult = useDevelopPageStore(
    (s) => (s.currentAppId ? s.publishStates[s.currentAppId]?.securityAnalysisResult ?? null : null)
  );
  const setSecurityAnalysisResult = useDevelopPageStore((state) => state.setSecurityAnalysisResult);
  // The scan can finish before the publish button leaves its "Publishing…" state. Hold the
  // result here and let an effect flush it once publish is fully resolved (see below), so the
  // security growl never overlaps the still-spinning publish button.
  const [pendingSecurityGrowl, setPendingSecurityGrowl] = useState<'safe' | 'issues' | null>(null);

  const showSecuritySafeGrowl = useCallback(() => {
    Growl.addGrowlMessage({
      id: 'security-scan-safe',
      title: t('builder_security_scan_complete_safe'),
      emphasis: 'success',
    });
  }, [t]);

  const showSecurityIssuesGrowl = useCallback(() => {
    Growl.addGrowlMessage({
      id: 'security-scan-issues',
      title: t('builder_security_scan_complete_title'),
      emphasis: 'warning',
      children: (
        <Box orientation='vertical' gap='md' className='min-w-[200px]'>
          <text.p size={-1}>
            {t('builder_security_scan_complete_subtitle')}
          </text.p>
          <Separator className='opacity-20' />
          <Box orientation='vertical' gap='sm' data-partial='inverted'>
            <Button
              design='primary'
              type='button'
              size='sm'
              text={t('builder_security_scan_view_fixes')}
              stretch
              data-eid={generateClickEID('security.growl.view_fixes')}
              onClick={() => {
                shipAnalyticsLog('security.growl.view_fixes_clicked', { ...(clickContext ?? {}) });
                logClickEvent('security.growl.view_fixes', clickContext)();
                Growl.removeGrowlMessage('security-scan-issues');
                setActiveChatTab(ChatTab.SETTINGS);
                setActiveSettingsSection(SettingsSection.SECURITY);
              }}
            />
          </Box>
        </Box>
      ),
    });
  }, [t, clickContext, setActiveChatTab, setActiveSettingsSection]);

  const handlePaywallPurchaseSuccess = useCallback(async () => {
    setPendingOpenAfterUpgrade(true);
  }, []);

  // Refresh site data (so the domain is current) then open the publish popover. Shared by the
  // post-purchase open paths below.
  const openPopoverWithFreshSite = useCallback(async () => {
    if (currentAppId) {
      try {
        await fetchSite(currentAppId, true, true);
      } catch {
        // Proceed to open even if the refresh fails
      }
    }
    setOpen(true);
  }, [currentAppId, fetchSite]);

  // Open popover after upgrade polling completes (control paywall path via handlePaywallPurchaseSuccess).
  useEffect(() => {
    if (!pendingOpenAfterUpgrade || isUpgradePolling) return;
    setPendingOpenAfterUpgrade(false);
    void openPopoverWithFreshSite();
  }, [pendingOpenAfterUpgrade, isUpgradePolling, openPopoverWithFreshSite]);

  // Combine-upgrade-with-publish treatment: auto-open the publish popover after the upsell upgrade.
  // PublishUpsellPopover arms `publishOpenAfterUpgradeAppId` on "See Plans"; once that app is paid
  // (showPaywall false) and post-purchase polling has settled (!isUpgradePolling), open the popover.
  // The arm is cleared HERE — at the actual open — not when showPaywall flips, so the intent survives
  // a remount during the polling window (e.g. mobile TOOLS<->PREVIEW toggle remounts the chat-toolbar
  // instance). The active-instance guard ensures exactly one instance acts (desktop -> header,
  // mobile -> chat toolbar); the arm lives in the store so the surviving instance picks it up.
  useEffect(() => {
    if (!isActivePublishInstance || !isDevelopPage) return;
    if (!currentAppId || publishOpenAfterUpgradeAppId !== currentAppId) return;
    if (showPaywall || isUpgradePolling) return;
    clearPublishOpenAfterUpgrade();
    void openPopoverWithFreshSite();
  }, [isActivePublishInstance, isDevelopPage, currentAppId, publishOpenAfterUpgradeAppId, showPaywall, isUpgradePolling, clearPublishOpenAfterUpgrade, openPopoverWithFreshSite]);

  // Safeguard: scope the arm to the current app. If the user moves to a different app without
  // completing the upgrade, drop the stale intent so it can't auto-open later on an unrelated
  // paid-state read. Keyed on app identity (not unmount), so mobile mode toggles that remount this
  // component for the same app do not clear a legitimately-armed intent.
  // The clear is deferred until `currentAppId` is known (non-null): on a post-purchase hard reload
  // the persisted arm rehydrates synchronously BEFORE the develop store hydrates currentAppId (it
  // starts null), so clearing while null would wipe the just-restored arm before the auto-open
  // effect above can consume it.
  useEffect(() => {
    if (currentAppId && publishOpenAfterUpgradeAppId && publishOpenAfterUpgradeAppId !== currentAppId) {
      clearPublishOpenAfterUpgrade();
    }
  }, [currentAppId, publishOpenAfterUpgradeAppId, clearPublishOpenAfterUpgrade]);

  // Use shared paywall modal hook (includes publish limit check)
  const { checkAndShowPaywall, paywallModal, isPaywallLoading, isPublishLimitLoading } = usePaywallModal({
    appId: currentAppId,
    source: 'publish',
    itc: PAYWALL_ITC.PUBLISH,
    onPurchaseSuccess: handlePaywallPurchaseSuccess,
  });

  const { data: subscription } = useSubscription();
  const planLabelKey = subscription?.plan ? getPlanDisplayLabelKey(subscription.plan) : '';
  const planName = planLabelKey ? t(planLabelKey) : '';
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
  const seoRegressionAlert = useDevelopPageStore(
    (state) => state.publishStates?.[currentAppId]?.seoRegressionAlert ?? null
  );
  const dismissSeoRegressionAlert = useDevelopPageStore((state) => state.dismissSeoRegressionAlert);

  useSeoQualityCheck(currentAppId);
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
  // Auth-at-Edge SSO publish gate. Disables Publish for SSO-required apps
  // until the customer has saved Client ID + Client Secret. UX layer only —
  // hosting's publish prerequisite is the canonical authority. Hidden for
  // non-ent / non-required apps (ssoRequired === false → not blocked).
  const sso = useAppSsoStatus(currentAppId);
  const isSsoBlocked = sso.ssoRequired && !sso.ssoConfigured;
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
    limit: 10,
    dedupe: false,
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
      setIsAgentInitiatedPublish(false);
    }
  }, [currentAppId, publishPopoverRequestNonce]);

  useEffect(() => {
    // This effect intentionally depends on `publishPopoverRequestNonce` so each
    // store increment is consumed exactly once by the active AppPublish instance.
    // The app-switch effect above must run first (same-commit effect order) to
    // seed `lastHandledPublishPopoverRequestRef` before this effect evaluates.
    if (!currentAppId || publishPopoverRequestNonce <= 0) return;
    if (!isActivePublishInstance) return;
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
    setIsAgentInitiatedPublish(true);
    openPopover();
  }, [currentAppId, isActivePublishInstance, openPopover, publishPopoverRequestNonce]);

  useEffect(() => {
    if (!isConversationInProgress) {
      setIsAgentInitiatedPublish(false);
    }
  }, [isConversationInProgress]);

  useEffect(() => {
    if (!currentAppId || !showFirstPublishCongrats) return;
    setOpen(false);
    setPublishResult(null);
  }, [currentAppId, showFirstPublishCongrats]);

  // Check if this is first-time publishing
  const isFirstTimePublishing = !hasBeenPublished(site);

  // Treatment publish-button click: emit the SAME canonical click EID control logs at its publish
  // button (publishTriggerClickEid), at the same funnel position (the upsell open, pre-paywall), so
  // the event is comparable across arms. publish_upsell.publish_click stays as the treatment intent.
  const handleUpsellPublishClick = useCallback(() => {
    logClickEvent(publishTriggerClickEid(location, isFirstTimePublishing), clickContext)();
  }, [location, isFirstTimePublishing, clickContext]);

  // Internal deploy function (called after QA gate passes or is skipped)
  const handleDeploy = useCallback(async () => {
    setPublishResult(null);

    if (isPublishComplianceBlocked) {
      logger.warn('app-publish.deploy.blocked-compliance', { appId: currentAppId, publishComplianceBlockReason });
      // Record the blocked attempt before returning so true attempt rate is measurable
      try {
        shipAnalyticsLog('publish.attempted', { appId: currentAppId, blockedReason: publishComplianceBlockReason, trigger: 'ui' })
        logImpressionEvent('develop.publish.attempt', { appId: currentAppId, blockedReason: publishComplianceBlockReason, trigger: 'ui' })()
      } catch (e) { logger.warn('app-publish.analytics.failed', { appId: currentAppId, error: e instanceof Error ? e.message : String(e) }) }
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
        // Gate (paywall / DNS conflict) blocked the publish — record as a blocked attempt
        try {
          shipAnalyticsLog('publish.attempted', { appId: currentAppId, blockedReason: 'gate_blocked', trigger: 'ui' })
          logImpressionEvent('develop.publish.attempt', { appId: currentAppId, blockedReason: 'gate_blocked', trigger: 'ui' })()
        } catch (e) { logger.warn('app-publish.analytics.failed', { appId: currentAppId, error: e instanceof Error ? e.message : String(e) }) }
        return;
      }
      if (gateResult.consent !== undefined) {
        setOpen(false);
      }

      clearPublishStatus(currentAppId);
      setIsPublishing(currentAppId, true);
      // Clear any prior scan outcome so the footer reverts to its pre-publish state for this run.
      setSecurityAnalysisResult(currentAppId, null);

      // publish.attempt: fires when user passes all gates
      try {
        shipAnalyticsLog('publish.attempted', { appId: currentAppId, commitHash: mostRecentDeployment?.gitHash, trigger: 'ui' })
        logImpressionEvent('develop.publish.attempt', { appId: currentAppId, trigger: 'ui' })()
      } catch (e) {
        logger.warn('app-publish.analytics.failed', { appId: currentAppId, error: e instanceof Error ? e.message : String(e) })
      }

      await publishMutation.mutateAsync({
        appId: currentAppId,
        dnsUpdateConsent: gateResult.consent,
      });
      JourneyTracker.current()?.trackMilestone('site_published', { appId: currentAppId })

      triggerAnalysis(currentAppId, site?.preview_url ?? undefined, {
        onSafe: () => {
          setSecurityAnalysisResult(currentAppId, 'safe');
          setPendingSecurityGrowl('safe');
        },
        onIssuesFound: () => {
          markSettingsNotification(currentAppId, SettingsSection.SECURITY);
          setSecurityAnalysisResult(currentAppId, 'issues');
          setPendingSecurityGrowl('issues');
        },
      });
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
  }, [clickContext, currentAppId, site, location, isFirstTimePublishing, isPublishComplianceBlocked, publishComplianceBlockReason, setPublishError, setIsPublishing, clearPublishStatus, publishMutation, runGate, triggerAnalysis, setSecurityAnalysisResult]);

  // Flush the deferred security growl only once publish is fully resolved.
  useEffect(() => {
    // TEMP (re-enable in follow-up PR): the security-scan result growl is disabled because it
    // overlaps the first-publish congrats / publish-success modals and confuses customers. The
    // pending-intent plumbing and growl builders below are intentionally kept so flipping this
    // flag back to true fully restores the behavior.
    const SECURITY_GROWL_ENABLED: boolean = false;
    if (!SECURITY_GROWL_ENABLED) return;
    if (!pendingSecurityGrowl || isPublishingOrDeploying) return;
    if (pendingSecurityGrowl === 'safe') {
      showSecuritySafeGrowl();
    } else {
      showSecurityIssuesGrowl();
    }
    setPendingSecurityGrowl(null);
  }, [pendingSecurityGrowl, isPublishingOrDeploying, showSecuritySafeGrowl, showSecurityIssuesGrowl]);

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

    if (!wasPublishing && isPublishingOrDeploying) setSecurityFooterDismissed(false);

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

  useEffect(() => {
    if (!seoRegressionAlert || !currentAppId) return;
    logger.info('seo-quality-alert.shown', {
      appId: currentAppId,
      scoreDelta: seoRegressionAlert.scoreDelta,
      currentScore: seoRegressionAlert.currentScore,
      affectedPages: seoRegressionAlert.regressions.length,
    });
    logImpressionEvent('seo.alert.shown', {
      scoreDelta: seoRegressionAlert.scoreDelta,
      currentScore: seoRegressionAlert.currentScore,
      affectedPages: seoRegressionAlert.regressions.length,
    })();
  }, [seoRegressionAlert, currentAppId]);

  const handleSeoRegressionFix = useCallback(() => {
    if (!seoRegressionAlert || !currentAppId) return;
    logger.info('seo-quality-alert.fix-clicked', {
      appId: currentAppId,
      scoreDelta: seoRegressionAlert.scoreDelta,
      currentScore: seoRegressionAlert.currentScore,
      affectedPages: seoRegressionAlert.regressions.length,
    });
    logClickEvent('seo.alert.fix', {
      scoreDelta: seoRegressionAlert.scoreDelta,
      currentScore: seoRegressionAlert.currentScore,
      affectedPages: seoRegressionAlert.regressions.length,
    })();
    dismissSeoRegressionAlert(currentAppId);
    window.postMessage(
      { type: 'seo-quality-fix-request', appId: currentAppId, regression: seoRegressionAlert },
      window.location.origin,
    );
  }, [seoRegressionAlert, currentAppId, dismissSeoRegressionAlert]);

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

  const handleViewSecurityFixes = useCallback(() => {
    shipAnalyticsLog('security.publish_footer.view_fixes_clicked', { ...(clickContext ?? {}) });
    logClickEvent('security.publish_footer.view_fixes', clickContext)();
    setOpen(false);
    setActiveChatTab(ChatTab.SETTINGS);
    setActiveSettingsSection(SettingsSection.SECURITY);
    if (currentAppId) setSecurityAnalysisResult(currentAppId, null);
    setSecurityFooterDismissed(true);
  }, [clickContext, setOpen, setActiveChatTab, setActiveSettingsSection, currentAppId, setSecurityAnalysisResult]);

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

  // aab_combine_upgrade_with_publish treatment: replace the normal publish popover with the
  // educational upsell. Safe as an early return — for a free treatment user the security/SEO/build
  // alerts and growls are inactive and paywallModal/dnsConflictModal are null; "See Plans" opens the
  // globally-mounted <UpgradeModal>, not this component's local modal. Chat-toolbar keeps today's
  // behavior (icon-only button has no room for the labeled upsell trigger). A free treatment user is
  // never mid-publish, so the label is the static "Publish" string.
  if (isTreatment && !isChatToolbar) {
    return (
      <>
        {paywallModal}
        {dnsConflictModal}
        <PublishUpsellPopover
          appId={currentAppId ?? undefined}
          triggerLabel={t('builder_publish_button')}
          triggerClassName="!rounded-xmd !pl-1.5 !pr-1.5 sm:!p-1 !border-none md:!border-solid"
          onPublishClick={handleUpsellPublishClick}
        />
      </>
    );
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
    isPublishComplianceBlocked ||
    isSsoBlocked;

  // Determine which status alert to show (priority order)
  const getPublishStatusAlert = () => {
    if (isConversationInProgress && !isAgentInitiatedPublish) {
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

    if (isSsoBlocked) {
      return (
        <Alert emphasis="critical">
          {t('builder_publish_sso_required_blocked')}
        </Alert>
      );
    }

    return null;
  };

  // Publish button label: "Publishing…" while a publish/deploy is in flight, otherwise "Publish".
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
    // No early-return on `isSsoBlocked` here — by design, the popover MUST
    // be allowed to open so `getPublishStatusAlert()` (line ~894) can render
    // the "SSO required → configure in Settings → SSO" alert that tells the
    // customer WHY publish is blocked. Same pattern as
    // `isPublishComplianceBlocked` above: the gate is in the disabled state
    // of the inner button and the alert inside the popover, not in a
    // handler short-circuit. Server-side enforcement comes from the BFF +
    // agents/ middleware + hosting publish prerequisite; a programmatic
    // bypass of this UI handler still can't trigger an actual publish.

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

  const isIconOnlyChatToolbarTrigger = isChatToolbar && !isMobile;

  const getTriggerButtonIcon = () => {
    if (isPublishingOrDeploying) {
      // Spinner's rotation animation causes it to overflow the icon only button bounds, increasing its size.
      return (
        <div className='relative flex items-center justify-center'>
          <Spinner size='sm' className='absolute' />
        </div>
      );
    }
    if (isIconOnlyChatToolbarTrigger) return <CloudUploadIcon className="!size-2.5" />;
  };

  const lastDeployedTimeAgo = lastDeployedDate ? timeAgo(lastDeployedDate) : null;

  // Publish-footer security state: a running scan wins; a finished scan that found issues shows the
  // "review fixes" prompt; otherwise the neutral pre-publish message.
  const securityFooterVariant: 'running' | 'issues' | 'idle' = isSecurityAnalysisRunning
    ? 'running'
    : securityAnalysisResult === 'issues'
      ? 'issues'
      : 'idle';

  return (
    <>
      {seoRegressionAlert && currentAppId && (
        <SeoQualityRegressionAlert
          onDismiss={() => dismissSeoRegressionAlert(currentAppId)}
          onFix={handleSeoRegressionFix}
        />
      )}
      {paywallModal}
      {dnsConflictModal}
      <Popover open={open} onOpenChange={handlePublish}>
        <PopoverTrigger asChild>
          <Button
            id="tour-publish-button"
            data-testid="publish-trigger-button"
            design='primary'
            size='sm'
            data-partial='componentAiro'
            icon={getTriggerButtonIcon()}
            text={isPublishingOrDeploying || isIconOnlyChatToolbarTrigger ? undefined : getPublishButtonText()}
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
                text={t('builder_settings_nav_feedback')}
              />
            )}

            {isSecurityScanUiEnabled && !securityFooterDismissed && (isPublishingOrDeploying || isSecurityAnalysisRunning || securityAnalysisResult !== null) && (
              <>
                <Separator />
                <div className='-mx-3 -mb-3 px-3 py-3 bg-intents-ux-boxLowContrast-backgroundColor rounded-b-md flex items-start gap-2'>
                  <div className='shrink-0 mt-0.5'>
                    {securityFooterVariant === 'running' ? (
                      <Spinner size='sm' data-partial='componentAiro' />
                    ) : securityFooterVariant === 'issues' ? (
                      <AlertIcon className='size-[1.25em] text-intents-ux-feedbackHighContrastWarning-feedbackColor' />
                    ) : (
                      <ShieldCheckIcon className='size-[1.25em] text-intents-ux-textSubtle-textColor' />
                    )}
                  </div>
                  {securityFooterVariant === 'issues' ? (
                    <Box orientation='vertical' gap='sm' className='min-w-0'>
                      <text.p size={-1}>
                        {t('builder_security_scan_complete_issues')}
                      </text.p>
                      <button
                        type='button'
                        onClick={handleViewSecurityFixes}
                        data-eid={generateClickEID('security.publish_footer.view_fixes')}
                        className='inline-flex items-center gap-0.5 self-start text-intents-ux-link-foregroundColor hover:cursor-pointer'
                      >
                        <text.span size={-1}>{t('builder_security_scan_view_fixes')}</text.span>
                        <ArrowRightIcon className='size-2' />
                      </button>
                    </Box>
                  ) : (
                    <text.p size={-1}>
                      {securityFooterVariant === 'running'
                        ? t('builder_security_scan_running_message')
                        : t('builder_security_scan_prepublish_message')}
                    </text.p>
                  )}
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
