'use client'

import { useRef, useState } from 'react';
import Alert from '@ux/alert';
import Button from '@ux/button';
import Card from '@ux/card';
import DownloadIcon from '@ux/icon/download';
import RevertIcon from '@ux/icon/revert';
import MuteIcon from '@ux/icon/volume-mute';
import UnmuteIcon from '@ux/icon/volume-up';
import text from '@ux/text';

import BigCard from '@/components/layout/BigCard';
import { useVideoGeneration } from '@/components/layout/PostPublishGoLiveModal/hooks/useVideoGeneration';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { agentService } from '@/services/AgentService';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';

interface VideoGenerationSectionProps {
  siteId: string
}

export function VideoGenerationSection({ siteId }: VideoGenerationSectionProps) {
  const t = useTranslations()
  const [isMuted, setIsMuted] = useState(true)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const getSite = useSitesStore((state) => state.getSite)
  const launchVideoResult = useDevelopPageStore((state) => state.getPublishState(siteId).launchVideoResult)
  const setLaunchVideoResult = useDevelopPageStore((state) => state.setLaunchVideoResult)
  const { isGeneratingVideo, videoError, generateVideo } = useVideoGeneration(siteId, getSite(siteId)?.published_url)

  const videoUrl = launchVideoResult?.type === 'success' ? launchVideoResult.url : null

  const handleRegenerate = async () => {
    if (isGeneratingVideo) {return}

    setRegenerateError(null)
    try {
      await agentService.deleteVideo(siteId)
      setLaunchVideoResult(siteId, null)
      await generateVideo()
      logger.info('settings.video.regenerate.started', { siteId })
    } catch (error) {
      logger.error('settings.video.regenerate.failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      setRegenerateError(t('golive_video_error_message'))
    }
  }

  const handleDownload = async () => {
    if (isDownloading) {return}

    setIsDownloading(true)
    setDownloadError(null)
    try {
      const blob = await agentService.downloadVideo(siteId)
      const blobUrl = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = blobUrl
      a.download = 'launch-video.mp4'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)

      logger.info('settings.video.downloaded', { siteId })
    } catch (error) {
      logger.error('settings.video.download-failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      setDownloadError(t('golive_video_download_error'))
    } finally {
      setIsDownloading(false)
    }
  }

  const description = t('builder_video_generating_description', undefined, 'Generate a 12 second vertical video clip to share in your social media based on what you built. Each generation will cost up to 30 credits.')

  return (
    <BigCard>
      {/* Row 1: title + description on left, action button on right */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <text.h3 as="title" size={2}>
            {t('builder_video_marketing_title', undefined, 'Marketing Video')}
          </text.h3>
          <text.p>
            {description}
          </text.p>
        </div>
        {videoUrl && !isGeneratingVideo ? (
          <Button
            design="primary"
            size="sm"
            icon={<RevertIcon />}
            disabled={isGeneratingVideo}
            onClick={handleRegenerate}
          >
            {t('builder_video_regenerate')}
          </Button>
        ) : (
          <Button
            design="primary"
            size="sm"
            text={isGeneratingVideo ? t('builder_common_generating') : t('builder_video_generate_title')}
            disabled={isGeneratingVideo}
            onClick={generateVideo}
          />
        )}
      </div>

      {/* Row 2: video + controls in white panel (only after generation) */}
      {videoUrl && !isGeneratingVideo && (
        <Card space={{ gap: 'sm', block: 'md' }}>
          <div className="flex items-end justify-between gap-6">
          <div className="rounded-lg overflow-hidden shrink-0 w-[220px] aspect-[9/16]">
            <video
              ref={videoRef}
              src={videoUrl}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex gap-2 ml-4">
            <Button
              design="secondary"
              size="sm"
              icon={isMuted ? <MuteIcon /> : <UnmuteIcon />}
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !videoRef.current.muted
                  setIsMuted(videoRef.current.muted)
                }
              }}
            >
              {isMuted ? t('golive_video_button_unmute') : t('golive_video_button_mute')}
            </Button>
            <Button
              design="primary"
              size="sm"
              icon={<DownloadIcon />}
              disabled={isDownloading}
              onClick={handleDownload}
            >
              {isDownloading ? t('golive_video_button_downloading') : t('golive_video_button_download')}
            </Button>
          </div>
          </div>
        </Card>
      )}

      {videoError && (
        <Alert emphasis="critical">
          {t('golive_video_error_message')}
        </Alert>
      )}
      {regenerateError && (
        <Alert emphasis="critical" onClose={() => setRegenerateError(null)}>
          {regenerateError}
        </Alert>
      )}
      {downloadError && (
        <Alert emphasis="critical" onClose={() => setDownloadError(null)}>
          {t('golive_video_download_error')}
        </Alert>
      )}
    </BigCard>
  )
}
