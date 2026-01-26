/**
 * Hook for managing video generation logic
 */

import { useCallback, useState } from 'react';

import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { agentService } from '@/services/AgentService';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

export function useVideoGeneration(appId: string) {
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const { setLaunchVideoUrl } = useDevelopPageStore();

  const generateVideo = useCallback(async () => {
    logger.info('go-live.video-generation.start', { appId, message: 'Starting video generation' });
    setIsGeneratingVideo(true);
    setVideoError(null);

    try {
      const result = await agentService.generateLaunchVideo(appId);

      if (result.success && result.video?.url) {
        const videoUrl = result.video.url;
        setLaunchVideoUrl(appId, videoUrl);

        shipAnalyticsLog('go_live.video.generated', {
          appId,
          jobId: result.video.jobId
        });

        logger.info('go-live.video-generation.success', {
          appId,
          videoUrl,
          publicPath: result.video.publicPath,
          jobId: result.video.jobId
        });
      } else {
        throw new Error(result.error || 'Video generation failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setVideoError(errorMessage);
      logger.error('go-live.video-generation.failure', { appId, error: errorMessage });
    } finally {
      setIsGeneratingVideo(false);
    }
  }, [appId, setLaunchVideoUrl]);

  return {
    isGeneratingVideo,
    videoError,
    generateVideo
  };
}
