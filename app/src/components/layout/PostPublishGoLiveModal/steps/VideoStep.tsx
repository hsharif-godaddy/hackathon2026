/**
 * Video generation step for Go Live modal
 * Shows video generation progress and plays generated video
 */

import { useRef, useState } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Spinner from '@ux/spinner';
import text from '@ux/text';

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
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleDownloadVideo = async () => {
    if (!launchVideoUrl || isDownloading) return;

    setIsDownloading(true);
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
      alert(t('golive_video_download_error'));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Box gap="lg">
      {/* Generating State */}
      {(isGeneratingVideo || (!launchVideoUrl && !videoError)) && (
        <Box
          gap="md"
          blockPadding="lg"
          inlinePadding="lg"
          className="bg-intents-ux-feedbackInfo-backgroundColor rounded-lg border border-intents-ux-feedbackInfo-borderColor"
        >
          <Box orientation="horizontal" gap="md" blockAlignChildren="center">
            <Spinner size="md" />
            <Box gap="sm" className="flex-1">
              <text.p as="paragraph" size={1} className="font-semibold">
                {t('golive_video_generating_title')}
              </text.p>
              <text.p as="paragraph" size={0} emphasis="passive">
                {t('golive_video_generating_description')}
              </text.p>
            </Box>
          </Box>
        </Box>
      )}

      {/* Error State */}
      {videoError && (
        <Alert emphasis="info">
          <text.p as="paragraph" size={0}>
            {t('golive_video_error_message')}
          </text.p>
        </Alert>
      )}

      {/* Video Preview */}
      {launchVideoUrl && !isGeneratingVideo && (
        <Box gap="md">
          <Box gap="sm" className="text-center">
            <text.p as="paragraph" size={1} className="font-medium">
              {t('golive_video_ready_title')}
            </text.p>
            <text.p as="paragraph" size={0} emphasis="passive">
              {t('golive_video_ready_description')}
            </text.p>
          </Box>

          <div className="flex items-start gap-4">
            {/* Video Player - Smaller size */}
            <div className="rounded-lg overflow-hidden bg-black shadow-lg" style={{ aspectRatio: '9/16', width: '180px', flexShrink: 0 }}>
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

            {/* Content and Controls */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              <Box gap="sm">
                <text.p as="paragraph" size={0}>
                  {t('golive_video_optimized_for')}
                </text.p>
                <text.p as="paragraph" size={0} emphasis="passive">
                  {t('golive_video_saved_to')} <code className="px-1 py-0.5 bg-intents-ux-boxLowContrast-backgroundColor rounded text-xs">/public/images</code> {t('golive_video_saved_to_suffix')}
                </text.p>
              </Box>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  design="secondary"
                  size="sm"
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.muted = !videoRef.current.muted;
                      setIsMuted(videoRef.current.muted);
                    }
                  }}
                >
                  {isMuted ? (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                      <span className="ml-1">{t('golive_video_button_unmute')}</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                      <span className="ml-1">{t('golive_video_button_mute')}</span>
                    </>
                  )}
                </Button>

                <Button
                  design="secondary"
                  size="sm"
                  onClick={handleDownloadVideo}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <>
                      <Spinner size="sm" />
                      <span className="ml-1">{t('golive_video_button_downloading')}</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span className="ml-1">{t('golive_video_button_download')}</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Box>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        {videoError && (
          <Button
            design="secondary"
            text={t('golive_video_button_skip')}
            size="md"
            onClick={onSkip}
          />
        )}
        <Button
          design="primary"
          text={t('golive_video_button_continue')}
          size="md"
          onClick={onContinue}
          disabled={isGeneratingVideo}
        />
      </div>
    </Box>
  );
}
