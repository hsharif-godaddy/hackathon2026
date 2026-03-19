/**
 * Hook for managing video generation with WebSocket-based async design
 *
 * This hook initiates video generation with a single HTTP request.
 * The backend handles all polling internally and pushes the final result
 * (success or failure) to the client via WebSocket with eventType "video".
 *
 * Video generation results are delivered via WebSocket and handled by
 * the VideoHandler, which updates the store automatically.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { agentService } from '@/services/AgentService';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

function normalizeVideoUrl(url: string): string {
  if (!url) return url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

export function useVideoGeneration(appId: string, publishedUrl?: string) {
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const generationRequestedRef = useRef(false);

  const setLaunchVideoResult = useDevelopPageStore((state) => state.setLaunchVideoResult);
  const launchVideoResult = useDevelopPageStore((state) => state.getPublishState(appId).launchVideoResult);
  const showGoLiveModal = useDevelopPageStore((state) => state.getPublishState(appId).showGoLiveModal);

  const generateVideo = useCallback(async () => {
    // Prevent duplicate requests
    if (generationRequestedRef.current) {
      logger.info('go-live.video-generation.already-requested', { appId });
      return;
    }

    logger.info('go-live.video-generation.start', { appId, publishedUrl });
    setIsGeneratingVideo(true);
    setVideoError(null);
    setLaunchVideoResult(appId, null);
    generationRequestedRef.current = true;

    try {
      const result = await agentService.generateLaunchVideo(appId, publishedUrl);

      logger.info('go-live.video-generation.response', { appId, status: result.status });

      // Video already complete (cached result)
      // Set the result and let the useEffect handle completion state + analytics
      if (result.status === 'completed' && result.url) {
        setLaunchVideoResult(appId, { type: 'success', url: normalizeVideoUrl(result.url) });
        return;
      }

      // Generation failed immediately (validation error, etc.)
      if (result.status === 'failed') {
        setVideoError(result.error || 'Video generation failed');
        setIsGeneratingVideo(false);
        generationRequestedRef.current = false;
        return;
      }

      // Generation in progress (status: 'pending' or 'queued')
      // Backend will emit WebSocket event when complete
      // VideoHandler will call setLaunchVideoResult when the video event arrives
      logger.info('go-live.video-generation.in-progress', {
        appId,
        status: result.status,
        message: 'Waiting for WebSocket completion event'
      });
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : 'Unknown error');
      setIsGeneratingVideo(false);
      generationRequestedRef.current = false;
    }
  }, [appId, publishedUrl, setLaunchVideoResult]);

  // Monitor launchVideoResult for completion or failure (WebSocket or cached)
  useEffect(() => {
    if (!launchVideoResult || !isGeneratingVideo) return;

    if (launchVideoResult.type === 'error') {
      logger.error('go-live.video-generation.websocket-failed', { appId, error: launchVideoResult.message });
      setVideoError(launchVideoResult.message);
      setIsGeneratingVideo(false);
      generationRequestedRef.current = false;
      setLaunchVideoResult(appId, null);
      return;
    }

    logger.info('go-live.video-generation.completed', { appId, videoUrl: launchVideoResult.url });
    setIsGeneratingVideo(false);
    generationRequestedRef.current = false;
    shipAnalyticsLog('go_live.video.generated', { appId });
  }, [appId, launchVideoResult, isGeneratingVideo, setLaunchVideoResult]);

  // Reset state when modal closes
  useEffect(() => {
    if (!showGoLiveModal) {
      setIsGeneratingVideo(false);
      generationRequestedRef.current = false;
    }
  }, [showGoLiveModal]);

  return { isGeneratingVideo, videoError, generateVideo };
}
