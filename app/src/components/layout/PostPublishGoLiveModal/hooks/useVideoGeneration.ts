/**
 * Hook for managing video generation with polling support
*/

import { useCallback, useEffect, useRef, useState } from 'react';

import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { agentService } from '@/services/AgentService';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

const POLLING_INTERVAL_MS = 7000; // 7 seconds between polls
const MAX_CONSECUTIVE_FAILURES = 3; // Stop polling after this many consecutive failures

/**
 * Normalize video URL to ensure it has proper protocol
 */
function normalizeVideoUrl(url: string): string {
  if (!url) return url;
  // If URL doesn't start with http:// or https://, add https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

export function useVideoGeneration(appId: string) {
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const consecutiveFailuresRef = useRef(0);

  const setLaunchVideoUrl = useDevelopPageStore((state) => state.setLaunchVideoUrl);
  const showGoLiveModal = useDevelopPageStore((state) => state.getPublishState(appId).showGoLiveModal);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const generateVideo = useCallback(async () => {
    logger.info('go-live.video-generation.start', { appId });
    setIsGeneratingVideo(true);
    setVideoError(null);

    try {
      const result = await agentService.generateLaunchVideo(appId);

      logger.info('go-live.video-generation.response', { appId, status: result.status });

      // Video already complete
      if (result.status === 'completed' && result.url) {
        setLaunchVideoUrl(appId, normalizeVideoUrl(result.url));
        setIsGeneratingVideo(false);
        shipAnalyticsLog('go_live.video.generated', { appId });
        return;
      }

      // Generation failed
      if (result.status === 'failed') {
        setVideoError(result.error || 'Video generation failed');
        setIsGeneratingVideo(false);
        return;
      }

      // Generation in progress - start polling
      consecutiveFailuresRef.current = 0;
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const pollResult = await agentService.generateLaunchVideo(appId);

          // Reset failure count on successful response
          consecutiveFailuresRef.current = 0;

          if (pollResult.status === 'completed' && pollResult.url) {
            setLaunchVideoUrl(appId, normalizeVideoUrl(pollResult.url));
            setIsGeneratingVideo(false);
            stopPolling();
            shipAnalyticsLog('go_live.video.generated', { appId });
          } else if (pollResult.status === 'failed') {
            setVideoError(pollResult.error || 'Video generation failed');
            setIsGeneratingVideo(false);
            stopPolling();
          }
        } catch (error) {
          consecutiveFailuresRef.current += 1;
          logger.warn('go-live.video-polling.error', {
            appId,
            consecutiveFailures: consecutiveFailuresRef.current,
            error: error instanceof Error ? error.message : String(error)
          });

          // Stop polling and show error after too many consecutive failures
          if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
            setVideoError('Unable to check video status. Please try again later.');
            setIsGeneratingVideo(false);
            stopPolling();
            shipAnalyticsLog('go_live.video.polling_failed', {
              appId,
              consecutiveFailures: consecutiveFailuresRef.current
            });
          }
        }
      }, POLLING_INTERVAL_MS);
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : 'Unknown error');
      setIsGeneratingVideo(false);
    }
  }, [appId, setLaunchVideoUrl, stopPolling]);

  // Stop polling when modal closes
  useEffect(() => {
    if (!showGoLiveModal && pollingIntervalRef.current) {
      stopPolling();
      setIsGeneratingVideo(false);
    }
  }, [showGoLiveModal, stopPolling]);

  // Cleanup on unmount
  useEffect(() => stopPolling, [stopPolling]);

  return { isGeneratingVideo, videoError, generateVideo };
}
