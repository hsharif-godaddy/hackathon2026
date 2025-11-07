'use client';

import { useCallback } from 'react';
import Alert from '@ux/alert';
import Button from '@ux/button';
import { usePublishApp } from '@/hooks/usePublishApp';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logger } from '@/lib/request-context';

/**
 * PublishStatusAlert Component
 *
 * - Publishing in progress (info alert with spinner)
 * - Publish failed (error alert with 'Try Again' button)
 * - Automatically hides when publish succeeds
 */
export default function PublishStatusAlert() {
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const getPublishState = useDevelopPageStore((state) => state.getPublishState);
  const setIsPublishing = useDevelopPageStore((state) => state.setIsPublishing);
  const setPublishError = useDevelopPageStore((state) => state.setPublishError);
  const clearPublishStatus = useDevelopPageStore((state) => state.clearPublishStatus);

  // Get publish state for current app
  const publishState = currentAppId ? getPublishState(currentAppId) : {
    isPublishing: false,
    publishError: false,
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
  };
  const { isPublishing, publishError, lastPublishedCommitHash, deploymentsRefetch } = publishState;

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

  if (!isPublishing && !publishError) {
    return null;
  }

  if (isPublishing) {
    return (
      <div className='px-4 pt-4'>
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
      <div className='px-4 pt-4'>
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

