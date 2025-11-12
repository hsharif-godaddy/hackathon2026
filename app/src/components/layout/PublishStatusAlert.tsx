'use client';

import { useCallback } from 'react';
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
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
    deploymentInProgressId: null,
    showSuccessAlert: false,
  };
  const { isPublishing, publishError, showSuccessAlert, lastPublishedCommitHash, deploymentsRefetch } = publishState;

  // Get site to extract FQDN for success alert
  const site = useSiteStore((state) => currentAppId ? state.getSite(currentAppId) : null);

  const publishMutation = usePublishApp();

  const handleTryAgain = useCallback(async () => {
    if (!currentAppId || !lastPublishedCommitHash) {
      logger.error('publish-alert.try-again.no-app-id', {
        message: 'Cannot retry: no app ID or commit hash available',
        appId: currentAppId,
        commitHash: lastPublishedCommitHash
      });
      if (currentAppId) {
        setPublishError(currentAppId, true);
      }
      return;
    }

    logger.info('publish-alert.try-again', {
      message: 'User clicked try again on failed publish',
      appId: currentAppId,
      commitHash: lastPublishedCommitHash.substring(0, 7)
    });

    clearPublishStatus(currentAppId);
    setIsPublishing(currentAppId, true);

    try {
      const { result, commitHash } = await publishMutation.mutateAsync({
        appId: currentAppId,
        commitHash: lastPublishedCommitHash
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
  }, [currentAppId, lastPublishedCommitHash, deploymentsRefetch, publishMutation, clearPublishStatus, setIsPublishing, setPublishError]);

  const handleDismiss = useCallback(() => {
    if (!currentAppId) return;
    
    logger.info('publish-alert.dismissed', {
      message: 'User dismissed publish status alert',
      appId: currentAppId,
    });
    
    clearPublishStatus(currentAppId);
  }, [currentAppId, clearPublishStatus]);

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
              text='View Now'
              data-eid={generateClickEID(`publish-alert.success.view_now`)}
              className="!hover:bg-transparent"
              href={fqdn ? (fqdn.includes('https://') ? fqdn : `https://${fqdn}`) : '#'}
              external
            />
          }
        >
          <text.h3 as='title' size={1}>Published Successfully!</text.h3>
          <text.p>
            Your app is now live at: <text.strong className='font-mono'>{fqdn}</text.strong>
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
          <div className='font-semibold'>Publishing in Progress</div>
          <div className='text-sm mt-1'>
            Your app is being published. This may take a few moments...
          </div>
        </Alert>
      </div>
    );
  }

  // Show error state only when not publishing
  if (publishError) {
    return (
      <div className='px-4 py-4'>
        <Alert
          emphasis='critical'
          onClose={handleDismiss}
          actions={<Button design='primary' onClick={handleTryAgain}>Try Again</Button>}
        >
          <div className='font-semibold'>Publish Failed</div>
          <div className='text-sm mt-1'>We failed to publish your app. Please try again.</div>
        </Alert>
      </div>
    );
  }

  return null;
}

