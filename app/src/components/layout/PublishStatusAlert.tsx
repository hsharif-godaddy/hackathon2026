'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Button from '@ux/button';
import text from '@ux/text';

import { ChatTab } from '@/app/develop/components/types';
import { useChatTabs } from '@/hooks/useChatTabs';
import { usePublishApp } from '@/hooks/usePublishApp';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
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
  const router = useRouter();
  const { setActiveChatTab } = useChatTabs();
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
  const deploymentsRefetch = useDevelopPageStore((state) =>
    state.publishStates[currentAppId]?.deploymentsRefetch ?? null
  );

  // Get site to extract FQDN for success alert
  const site = useSiteStore((state) => currentAppId ? state.getSite(currentAppId) : null);

  const publishMutation = usePublishApp();

  const handleTryAgain = useCallback(async () => {
    if (!currentAppId) {
      logger.error('publish-alert.try-again.no-app-id', {
        message: 'Cannot retry: no app ID available',
        appId: currentAppId,
      });
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
  }, [currentAppId, deploymentsRefetch, publishMutation, clearPublishStatus, setIsPublishing, setPublishError]);

  const handleDismiss = useCallback(() => {
    if (!currentAppId) return;

    logger.info('publish-alert.dismissed', {
      message: 'User dismissed publish status alert',
      appId: currentAppId,
    });

    clearPublishStatus(currentAppId);
  }, [currentAppId, clearPublishStatus]);

  const handleFixBuildError = useCallback(() => {
    if (!currentAppId || !buildErrorDetails) return;

    logger.info('publish-alert.fix-build-error', {
      message: 'User clicked fix build error',
      appId: currentAppId,
    });

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

  const handleViewSettings = useCallback(() => {
    if (!currentAppId) return;

    logger.info('publish-alert.view-settings', {
      message: 'User clicked view domain settings from publish success alert',
      appId: currentAppId,
    });

    router.push(`/develop/${currentAppId}?tab=settings&settings=domain`);
  }, [currentAppId, router]);

  // Automatically show Go Live modal on successful publish if user hasn't gone live yet
  useEffect(() => {
    if (showSuccessAlert && currentAppId && hasBeenPublished(site)) {
      const publishState = getPublishState(currentAppId);
      if (!publishState?.hasGoneLive) {
        logger.info('publish-alert.auto-show-go-live-modal', {
          message: 'Automatically showing Go Live modal after successful publish',
          appId: currentAppId,
        });
        setShowGoLiveModal(currentAppId, true);
      }
    }
  }, [showSuccessAlert, currentAppId, site, getPublishState, setShowGoLiveModal]);

  if (!isPublishing && !publishError && !showSuccessAlert) {
    return null;
  }

  // Show success alert when deployment completes
  if (showSuccessAlert && currentAppId && hasBeenPublished(site)) {
    // Get the FQDN with fallback priority:
    // 1. Custom domain where domainType != 'prefix'
    // 2. Prefix domain where domainType = 'prefix'
    // 3. Published URL from site.published_url
    const customDomain = site?.domains?.find(d => d.domainType && d.domainType !== 'prefix');
    const prefixDomain = site?.domains?.find(d => d.domainType === 'prefix');
    const publishedFqdn = site?.published_url;

    const rawFqdn = customDomain?.fqdn || prefixDomain?.fqdn || publishedFqdn || '';

    // Ensure FQDN has https:// protocol for external link
    // Handle empty string to avoid creating invalid 'https://' URL
    const fqdn = !rawFqdn
      ? ''
      : (rawFqdn.startsWith('http://') || rawFqdn.startsWith('https://')
          ? rawFqdn
          : `https://${rawFqdn}`);

    return (
      <div className='px-2 py-2'>
        <Alert
          emphasis='success'
          onClose={() => currentAppId && dismissPublishSuccess(currentAppId)}
          actions={
            <Button
              design="primary"
              text={t('builder_publish_success_button_domain')}
              data-eid={generateClickEID(`publish-alert.success.custom_domain`)}
              className="!hover:bg-transparent"
              onClick={handleViewSettings}
            />
          }
        >
          <text.h3 as='title' size={1}>{t('builder_publish_success_title')}</text.h3>
          <text.p>
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
          </text.p>
        </Alert>
      </div>
    );
  }

  if (isPublishing) {
    return (
      <div className='px-2 py-2'>
        <Alert
          emphasis='info'
        >
          <div className='font-semibold'>{t('builder_publish_progress_title')}</div>
          <div className='text-sm mt-0.5'>
            {t('builder_publish_progress_message')}
          </div>
        </Alert>
      </div>
    );
  }

  // Show build error state with detailed error and fix button
  if (publishError && buildErrorDetails) {
    return (
      <div className='px-2 py-2'>
        <Alert
          emphasis='critical'
          onClose={handleDismiss}
          actions={
            <div className='flex gap-1'>
              <Button design='secondary' onClick={handleTryAgain} text={t('builder_publish_error_button_try_again')} />
              <Button design='primary' onClick={handleFixBuildError} text={t('builder_publish_error_button_fix')} />
            </div>
          }
        >
          <div className='font-semibold'>{t('builder_publish_build_failed_title')}</div>
          <div className='text-sm mt-0.5'>
            {buildErrorDetails.error}
          </div>
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
          actions={<Button design='primary' onClick={handleTryAgain} text={t('builder_publish_error_button_try_again')} />}
        >
          <div className='font-semibold'>{t('builder_publish_failed_title')}</div>
          <div className='text-sm mt-0.5'>{t('builder_publish_failed_message')}</div>
        </Alert>
      </div>
    );
  }

  return null;
}

