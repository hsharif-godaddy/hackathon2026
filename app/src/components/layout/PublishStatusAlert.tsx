// Intentionally retained as fallback if publish popover alerts prove insufficient.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Button from '@ux/button';
import text from '@ux/text';

import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types';
import { Feedback } from '@/components/feedback/Feedback';
import { FEEDBACK_ID } from '@/components/feedback/utils';
import { useChatTabs } from '@/hooks/useChatTabs';
import { usePublishApp } from '@/hooks/usePublishApp';
import { usePublishComplianceGate } from '@/hooks/usePublishComplianceGate';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { PublishComplianceBlockReason } from '@/lib/subscription';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore';
import { isAiroSubdomain, resolveSiteFqdn } from '@/utils/domain';
import { generateClickEID } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

/**
 * PublishStatusAlert Component
 *
 * Displays alerts for various publish states:
 * - Publishing in progress (info alert)
 * - Publish failed (error alert with 'Try Again' button)
 * - Publish succeeded (success alert with FQDN link to view app)
 *
 * The success alert appears when a deployment completes successfully and
 * displays the app's FQDN with the following priority:
 * 1. Primary custom domain (site.domains[].fqdn where isPrimary=true)
 * 2. First custom domain (site.domains[0].fqdn)
 * 3. Preview URL as fallback (site.preview_url)
 *
 * The alert can be dismissed by the user and does not persist across refreshes.
 */
export default function PublishStatusAlert() {
  const t = useTranslations();
  const [showFeedback, setShowFeedback] = useState(false);
  const [isFixingBuildError, setIsFixingBuildError] = useState(false);
  const isLoading = useIsLoading();
  const isStreaming = useIsActivelyStreaming();
  const isProcessing = isLoading || isStreaming;
  const prevIsProcessingRef = useRef(isProcessing);
  const { setActiveChatTab, setActiveSettingsSection } = useChatTabs();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const dismissPublishSuccess = useDevelopPageStore((state) => state.dismissPublishSuccess);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);
  const setShowGoLiveModal = useDevelopPageStore((state) => state.setShowGoLiveModal);
  const getPublishState = useDevelopPageStore((state) => state.getPublishState);
  const isPublishing = useDevelopPageStore((state) =>
    state.publishStates[currentAppId]?.isPublishing ?? false
  );
  const publishError = useDevelopPageStore((state) =>
    state.publishStates[currentAppId]?.publishError ?? false
  );
  const buildErrorDetails = useDevelopPageStore((state) =>
    state.publishStates[currentAppId]?.buildErrorDetails ?? null
  );
  const showSuccessAlert = useDevelopPageStore((state) =>
    state.publishStates[currentAppId]?.showSuccessAlert ?? false
  );
  const showPostPublishFeatureSelection = useDevelopPageStore((state) =>
    currentAppId && state.publishStates?.[currentAppId]
      ? state.publishStates[currentAppId].showPostPublishFeatureSelection
      : false
  );
  const deploymentsRefetch = useDevelopPageStore((state) =>
    state.publishStates[currentAppId]?.deploymentsRefetch ?? null
  );

  // Get site to extract FQDN for success alert
  const site = useSiteStore((state) => currentAppId ? state.getSite(currentAppId) : null);
  const { isBlocked: isPublishComplianceBlocked, blockReason: publishComplianceBlockReason } =
    usePublishComplianceGate(site, { enabled: !!currentAppId });

  const publishMutation = usePublishApp();

  const handleTryAgain = useCallback(async () => {
    if (!currentAppId) {
      logger.error('publish-alert.try-again.no-app-id', {
        message: 'Cannot retry: no app ID available',
        appId: currentAppId,
      });
      return;
    }

    if (isPublishComplianceBlocked) {
      logger.warn('publish-alert.try-again.blocked-compliance', { appId: currentAppId });
      return;
    }

    logger.info('publish-alert.try-again', {
      message: 'User clicked try again on failed publish',
      appId: currentAppId,
    });

    clearPublishStatus(currentAppId);
    setIsPublishing(currentAppId, true);

    try {
      const { result, commitHash } = await publishMutation.mutateAsync({
        appId: currentAppId,
      });

      logger.info('publish-alert.try-again.success', {
        appId: currentAppId,
        commitHash: commitHash.substring(0, 7),
        result
      });

      // Refetch deployments to start polling
      if (deploymentsRefetch) {
        await deploymentsRefetch();
      }
    } catch (error) {
      logger.error('publish-alert.try-again.error', {
        message: 'Retry failed',
        appId: currentAppId,
        error: error instanceof Error ? error.message : String(error)
      });
      setPublishError(currentAppId, true);
      setIsPublishing(currentAppId, false);
    }
  }, [currentAppId, deploymentsRefetch, isPublishComplianceBlocked, publishMutation, clearPublishStatus, setIsPublishing, setPublishError]);

  const handleDismiss = useCallback(() => {
    if (!currentAppId) return;

    logger.info('publish-alert.dismissed', {
      message: 'User dismissed publish status alert',
      appId: currentAppId,
    });

    clearPublishStatus(currentAppId);
    setIsFixingBuildError(false);
  }, [currentAppId, clearPublishStatus]);

  const handleFixBuildError = useCallback(() => {
    if (!currentAppId || !buildErrorDetails) return;

    logger.info('publish-alert.fix-build-error', {
      message: 'User clicked fix build error',
      appId: currentAppId,
    });

    setIsFixingBuildError(true);

    // Switch to chat tab so user sees the AI response
    setActiveChatTab(ChatTab.CHAT);

    // Dispatch event to trigger the fix flow - similar to 404 error fix pattern
    window.postMessage({
      type: 'build-error-fix-request',
      appId: currentAppId,
      errorMessage: buildErrorDetails.error,
      errorDetails: buildErrorDetails.details,
      exitCode: buildErrorDetails.exitCode,
    }, window.location.origin);
  }, [currentAppId, buildErrorDetails, setActiveChatTab]);

  // When the agent finishes processing (transitions true → false), clear the fixing
  // state so the alert returns to the normal error view (user may still need to re-publish).
  // Using prevIsProcessingRef avoids incorrectly resetting on the initial click, where
  // isProcessing is still false before the agent has even started.
  useEffect(() => {
    const wasProcessing = prevIsProcessingRef.current;
    prevIsProcessingRef.current = isProcessing;

    if (wasProcessing && !isProcessing && isFixingBuildError) {
      setIsFixingBuildError(false);
    }
  }, [isProcessing, isFixingBuildError]);

  // Fallback: if isFixingBuildError is set but isProcessing never becomes true
  // (e.g. sendMessage silently fails), reset after a short window
  useEffect(() => {
    if (!isFixingBuildError || isProcessing) return;
    const timeout = setTimeout(() => {
      if (!prevIsProcessingRef.current) {
        setIsFixingBuildError(false);
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [isFixingBuildError, isProcessing]);

  const handleViewSettings = useCallback(() => {
    if (!currentAppId) return;

    logger.info('publish-alert.view-settings', {
      message: 'User clicked view domain settings from publish success alert',
      appId: currentAppId,
    });

    dismissPublishSuccess(currentAppId);
    setActiveChatTab(ChatTab.SETTINGS);
    setActiveSettingsSection(SettingsSection.DOMAIN);
  }, [currentAppId, dismissPublishSuccess, setActiveChatTab, setActiveSettingsSection]);

  // Pre-fetch while publishing so the flag is in cache before the success alert appears.
  // Without this, gating on showSuccessAlert alone causes a race: the flag fetch starts at
  // the same moment the alert shows, so isGoLiveEnabled is undefined on the first effect run
  // and the modal never fires if the alert is dismissed before the request completes.
  const { data: isGoLiveEnabled } = useSwitchboard('appbuilder-go-live', { enabled: showSuccessAlert || isPublishing });

  // Automatically show Go Live modal on successful publish if user hasn't gone live yet
  // and hasn't previously dismissed the modal in this session
  useEffect(() => {
    if (showPostPublishFeatureSelection) {
      return;
    }
    if (isGoLiveEnabled && showSuccessAlert && currentAppId && hasBeenPublished(site)) {
      const publishState = getPublishState(currentAppId);
      if (!publishState?.hasGoneLive && !publishState?.goLiveModalDismissed) {
        logger.info('publish-alert.auto-show-go-live-modal', {
          message: 'Automatically showing Go Live modal after successful publish',
          appId: currentAppId,
        });
        setShowGoLiveModal(currentAppId, true);
      }
    }
  }, [isGoLiveEnabled, showSuccessAlert, showPostPublishFeatureSelection, currentAppId, site, getPublishState, setShowGoLiveModal]);

  useEffect(() => {
    if (!isPublishing && !publishError && !showSuccessAlert) {
      setShowFeedback(false);
    }
  }, [isPublishing, publishError, showSuccessAlert]);

  if (!isPublishing && !publishError && !showSuccessAlert) {
    return null;
  }

  const feedbackButton = (
    <Button
      design="secondary"
      text={t('builder_settings_nav_feedback')}
      data-eid={generateClickEID('publish-alert.feedback')}
      onClick={() => setShowFeedback(true)}
    />
  );

  const feedbackModal = showFeedback && (
    <Feedback
      feedbackId={FEEDBACK_ID}
      onClose={() => setShowFeedback(false)}
      onSubmitSuccess={() => setShowFeedback(false)}
      origin="Publish banner"
    />
  );

  // Show success alert when deployment completes
  if (showSuccessAlert && currentAppId && hasBeenPublished(site)) {
    const fqdn = resolveSiteFqdn(site);
    const showDomainButton = isAiroSubdomain(fqdn);

    return (
      <div className='px-2 py-1' data-testid="publish-success-alert">
        <Alert
          emphasis='success'
          onClose={() => currentAppId && dismissPublishSuccess(currentAppId)}
          title={t('builder_publish_success_title')}
          actions={showDomainButton && (
            <Button
              design="primary"
              text={t('builder_publish_success_button_domain')}
              data-eid={generateClickEID(`publish-alert.success.custom_domain`)}
              className="!hover:bg-transparent"
              onClick={handleViewSettings}
            />
          )}
        >
          <div className='flex flex-col gap-0.5'>
            <span>
              <FormattedMessage
                id='builder_publish_success_message'
                values={{
                  fqdn: (
                    <Button
                      design='inline'
                      href={fqdn}
                      text={fqdn.replace('https://', '')}
                      external
                    />
                  )
                }}
              />
            </span>
            <Button
              design='inline'
              data-eid={generateClickEID('publish-alert.success.feedback')}
              onClick={() => setShowFeedback(true)}
            >
              <text.span emphasis='passive'>{t('builder_settings_nav_feedback')}</text.span>
            </Button>
          </div>
        </Alert>
        {feedbackModal}
      </div>
    );
  }

  if (isPublishing) {
    return (
      <div className='px-2 py-1'>
        <Alert
          emphasis='info'
          title={t('builder_publish_progress_title')}
          actions={feedbackButton}
        >
          {t('builder_publish_progress_message')}
        </Alert>
        {feedbackModal}
      </div>
    );
  }

  // Show build error state with detailed error and fix button
  if (publishError && buildErrorDetails) {
    // Swap to an info panel once the user has requested a fix.
    // Show immediately on click (isFixingBuildError alone) to prevent double-send.
    if (isFixingBuildError) {
      return (
        <div className='px-2 py-1'>
          <Alert
            emphasis='info'
            onClose={handleDismiss}
            title={t('builder_publish_fixing_title')}
          >
            {t('builder_publish_fixing_message')}
          </Alert>
        </div>
      );
    }

    return (
      <div className='px-2 py-1'>
        <Alert
          emphasis='critical'
          onClose={handleDismiss}
          title={t('builder_publish_build_failed_title')}
          actions={
            <div className='flex gap-1'>
              {!isPublishComplianceBlocked && (
                <Button design='secondary' onClick={handleTryAgain} text={t('builder_publish_error_button_try_again')} />
              )}
              <Button design='primary' onClick={handleFixBuildError} text={t('builder_publish_error_button_fix')} />
            </div>
          }
        >
          {buildErrorDetails.error}
          {buildErrorDetails.exitCode && (
            <text.p size={0} emphasis='passive' className='mt-0.5'>
              {t('builder_publish_build_failed_exit_code', { exitCode: buildErrorDetails.exitCode })}
            </text.p>
          )}
        </Alert>
      </div>
    );
  }

  // Show generic error state only when not publishing
  if (publishError) {
    return (
      <div className='px-2 py-2'>
        <Alert
          emphasis='critical'
          onClose={handleDismiss}
          title={t('builder_publish_failed_title')}
          actions={
            isPublishComplianceBlocked ? undefined : (
              <Button design='primary' onClick={handleTryAgain} text={t('builder_publish_error_button_try_again')} />
            )
          }
        >
          {isPublishComplianceBlocked
            ? publishComplianceBlockReason === PublishComplianceBlockReason.SiteSuspended
              ? t('builder_manageplan_apps_publish_blocked_suspended')
              : t('builder_manageplan_apps_publish_blocked_subscription')
            : t('builder_publish_failed_message')}
        </Alert>
      </div>
    );
  }

  return null;
}
