/**
 * Video generation step for Go Live modal
 * Shows video generation progress and plays generated video
 */

import { useRef, useState } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import DownloadIcon from '@ux/icon/download';
import MuteIcon from '@ux/icon/volume-mute';
import UnmuteIcon from '@ux/icon/volume-up';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import { ButtonBar } from '@/components/layout/PostPublishGoLiveModal/components/ButtonBar';
import { Loader } from '@/components/layout/PostPublishGoLiveModal/components/Loader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';

interface VideoStepProps {
  appId: string;
  isGeneratingVideo: boolean;
  videoError: string | null;
  launchVideoUrl: string | null;
  onContinue: () => void;
  onSkip: () => void;
}

export function VideoStep({
  appId,
  isGeneratingVideo,
  videoError,
  launchVideoUrl,
  onContinue,
  onSkip
}: VideoStepProps) {
  const t = useTranslations();
  const [isMuted, setIsMuted] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMobile = useIsMobile();

  const handleDownloadVideo = async () => {
    if (!launchVideoUrl || isDownloading) return;

    setIsDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch(launchVideoUrl);
      if (!response.ok) throw new Error('Failed to fetch video');

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'launch-video.mp4';
      document.body.appendChild(a);
      a.click();

      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      logger.info('go-live.video.downloaded', { appId });
    } catch (error) {
      logger.error('go-live.video.download-failed', {
        appId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      setDownloadError(t('golive_video_download_error'));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Box gap="xl">
      {/* Generating State */}
      {(isGeneratingVideo || (!launchVideoUrl && !videoError)) && (
        <Loader
          title={t('golive_video_generating_title')}
          description={t('golive_video_generating_description')}
        />
      )}

      {/* Error State */}
      {videoError && (
        <Alert emphasis="info">
          {t('golive_video_error_message')}
        </Alert>
      )}

      {/* Video Preview */}
      {launchVideoUrl && !isGeneratingVideo && (
        <div className="flex flex-col-reverse md:flex-row items-center gap-2">
          {/* Video Player Wrapper */}
          <div className="flex justify-center md:w-1/3">
            {/* Video Player - Smaller size */}
            <div className="rounded-lg overflow-hidden shadow-lg w-[180px] aspect-[9/16] shrink-0">
              <video
                ref={videoRef}
                src={launchVideoUrl}
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Content and Controls */}
          <div className="flex md:flex-1 flex-col items-center md:items-start md:justify-center gap-4">
            <TextLockup
              title={t('golive_video_ready_title')}
              centered={isMobile}
            >
              <text.p>
                {t('golive_video_optimized_for')}
              </text.p>
              <text.p emphasis="passive">
                {t('golive_video_saved_to')} <code className="px-1 py-0.5 bg-intents-ux-boxLowContrast-backgroundColor rounded text-xs">/public/images</code> {t('golive_video_saved_to_suffix')}
              </text.p>
            </TextLockup>

            <Box gap="md" className="w-full">
              {/* Download Error State */}
              {downloadError && (
                <Alert emphasis="critical" onClose={() => setDownloadError(null)}>
                  {downloadError}
                </Alert>
              )}

              {/* Mute and Download Controls */}
              <Box
                orientation="horizontal"
                blockAlignChildren={isMobile ? 'center' : 'start'}
                gap="sm"
                wrap
              >
                <Button
                  design="secondary"
                  size="sm"
                  icon={isMuted ? <MuteIcon /> : <UnmuteIcon />}
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.muted = !videoRef.current.muted;
                      setIsMuted(videoRef.current.muted);
                    }
                  }}
                  text={isMuted ? t('golive_video_button_unmute') : t('golive_video_button_mute')}
                />

                <Button
                  design="secondary"
                  size="sm"
                  icon={<DownloadIcon />}
                  onClick={handleDownloadVideo}
                  disabled={isDownloading}
                  text={isDownloading ? t('golive_video_button_downloading') : t('golive_video_button_download')}
                />
              </Box>
            </Box>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <ButtonBar>
        <Button
          design="secondary"
          text={t('golive_video_button_skip')}
          size="md"
          onClick={onSkip}
        />
        <Button
          design="primary"
          text={t('golive_video_button_continue')}
          size="md"
          onClick={onContinue}
          disabled={isGeneratingVideo}
        />
      </ButtonBar>
    </Box>
  );
}
