'use client';

import { useCallback } from 'react';
import { FormattedMessage } from 'react-intl';
import { useTranslations } from '@/hooks/useTranslations';
import Alert from '@ux/alert';
import Button from '@ux/button';
import text from '@ux/text';
import { usePublishApp } from '@/hooks/usePublishApp';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { logger } from '@/lib/request-context';
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
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const getPublishState = useDevelopPageStore((state) => state.getPublishState);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const dismissPublishSuccess = useDevelopPageStore((state) => state.dismissPublishSuccess);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);

  // Get publish state for current app
  const publishState = currentAppId ? getPublishState(currentAppId) : {
    isPublishing: false,
    publishError: false,
    buildErrorDetails: null,
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
    deploymentInProgressId: null,
    showSuccessAlert: false,
  };
  const { isPublishing, publishError, buildErrorDetails, showSuccessAlert, lastPublishedCommitHash, deploymentsRefetch } = publishState;

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

    // Dispatch event to trigger the fix flow - similar to 404 error fix pattern
    window.postMessage({
      type: 'build-error-fix-request',
      appId: currentAppId,
      errorMessage: buildErrorDetails.error,
      errorDetails: buildErrorDetails.details,
      exitCode: buildErrorDetails.exitCode,
    }, window.location.origin);
  }, [currentAppId, buildErrorDetails]);

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

    const fqdn = customDomain?.fqdn || prefixDomain?.fqdn || publishedFqdn;

    return (
      <div className='px-4 py-4'>
        <Alert
          emphasis='success'
          onClose={() => currentAppId && dismissPublishSuccess(currentAppId)}
          actions={
            <Button
              design="primary"
              as='external'
              text={t('builder_publish_success_button_view')}
              data-eid={generateClickEID(`publish-alert.success.view_now`)}
              className="!hover:bg-transparent"
              href={`/develop/${currentAppId}?tab=settings&settings=domain`}
            />
          }
        >
          <text.h3 as='title' size={1}>{t('builder_publish_success_title')}</text.h3>
          <text.p>
            <FormattedMessage
              id='builder_publish_success_message'
              values={{
                fqdn: fqdn.replace('https://', ''),
                strong: (chunks) => <text.strong>{chunks}</text.strong>
              }}
            />
          </text.p>
        </Alert>
      </div>
    );
  }

  if (isPublishing) {
    return (
      <div className='px-4 py-4'>
        <Alert
          emphasis='info'
        >
          <div className='font-semibold'>{t('builder_publish_progress_title')}</div>
          <div className='text-sm mt-1'>
            {t('builder_publish_progress_message')}
          </div>
        </Alert>
      </div>
    );
  }

  // Show build error state with detailed error and fix button
  if (publishError && buildErrorDetails) {
    return (
      <div className='px-4 py-4'>
        <Alert
          emphasis='critical'
          onClose={handleDismiss}
          actions={
            <div className='flex gap-2'>
              <Button design='secondary' onClick={handleTryAgain}>{t('builder_publish_error_button_try_again')}</Button>
              <Button design='primary' onClick={handleFixBuildError}>{t('builder_publish_error_button_fix')}</Button>
            </div>
          }
        >
          <div className='font-semibold'>{t('builder_publish_build_failed_title')}</div>
          <div className='text-sm mt-1'>
            {buildErrorDetails.error}
          </div>
          {buildErrorDetails.exitCode && (
            <text.p size={0} emphasis='passive' className='mt-1'>
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
      <div className='px-4 py-4'>
        <Alert
          emphasis='critical'
          onClose={handleDismiss}
          actions={<Button design='primary' onClick={handleTryAgain}>{t('builder_publish_error_button_try_again')}</Button>}
        >
          <div className='font-semibold'>{t('builder_publish_failed_title')}</div>
          <div className='text-sm mt-1'>{t('builder_publish_failed_message')}</div>
        </Alert>
      </div>
    );
  }

  return null;
}

