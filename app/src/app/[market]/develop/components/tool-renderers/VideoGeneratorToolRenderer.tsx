'use client'

import { Play, Video } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { resolveGeneratedVideoPlaybackUrl } from '@/app/[market]/develop/components/media/slotImageUrl'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import MediaModal from '@/app/[market]/develop/components/tool-renderers/MediaModal'
import { parseGenerateVideoTool } from '@/app/[market]/develop/components/tool-renderers/parseGenerateVideoTool'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { useTranslations } from '@/hooks/useTranslations'
import { defaultMessageForVideoToolKey } from '@/lib/translations/video-tool-defaults'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'
import { postMessageToIframe } from '@/utils/postMessage'

interface VideoResult {
  url: string
  slotPath?: string
  slotUrl?: string
}

/**
 * Custom renderer for media-video__generate_video and media__generate_video tools.
 *
 * Displays AI-generated video with inline player and modal for fullscreen view.
 */
export default function VideoGeneratorToolRenderer({
  toolName: _toolName,
  toolStatus,
  toolId,
  input: _input,
  result,
  error,
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const params = useParams()
  const appId = params?.id as string | undefined
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId ?? '')?.url ?? null)
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)
  const [isPlaying, setIsPlaying] = useState(false)
  const inlineVideoRef = useRef<HTMLVideoElement>(null)
  const modalVideoRef = useRef<HTMLVideoElement>(null)

  const parsed = parseGenerateVideoTool({
    id: toolId ?? '',
    name: _toolName,
    status: toolStatus,
    input: _input ?? {},
    result,
    error,
  })

  const generationPrompt = parsed.prompt
  const generationError = parsed.error
  const video: VideoResult | null = parsed.videoUrl
    ? {
        url: parsed.videoUrl,
        slotPath: parsed.slotPath,
        slotUrl: parsed.slotUrl,
      }
    : null

  const hasVideo = video !== null
  const isTerminalFailure: boolean = !hasVideo
    && !generationError
    && (toolStatus === 'completed' || toolStatus === 'incomplete')
  const hasDetails = hasVideo || Boolean(generationError)
  const playbackUrl = video
    ? resolveGeneratedVideoPlaybackUrl(video.url, previewBaseUrl, {
        slotUrl: video.slotUrl,
        slotPath: video.slotPath,
      })
    : ''

  const hasNotifiedRef = useRef(false)
  const slotPath = video?.slotPath
  useEffect(() => {
    if (toolStatus === 'completed' && hasVideo && slotPath && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, {
          type: 'RELOAD_MEDIA_SLOT',
          slotPath,
          isVideo: true,
        })
      }
    }
  }, [toolStatus, hasVideo, slotPath])

  const handleInlinePlayPause = () => {
    if (inlineVideoRef.current) {
      if (isPlaying) {
        inlineVideoRef.current.pause()
        setIsPlaying(false)
      } else {
        inlineVideoRef.current.play()
        setIsPlaying(true)
      }
    }
  }

  const handleModalOpen = () => {
    if (inlineVideoRef.current) {
      inlineVideoRef.current.pause()
      setIsPlaying(false)
    }
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    if (modalVideoRef.current) {
      modalVideoRef.current.pause()
    }
    setIsModalOpen(false)
  }

  const shouldShowHeader = toolStatus !== 'completed' || !hasVideo

  const headerLabel = generationError
    ? generationError
    : toolStatus === 'completed' && hasVideo
      ? t(
          'builder_tools_video_generated_prompt',
          { prompt: generationPrompt },
          defaultMessageForVideoToolKey('builder_tools_video_generated_prompt'),
        )
      : isTerminalFailure
        ? t(
            'builder_tools_video_generate_failed_count',
            { count: 1 },
            defaultMessageForVideoToolKey('builder_tools_video_generate_failed_count'),
          )
        : t(
            'builder_tools_active_video_generate',
            undefined,
            defaultMessageForVideoToolKey('builder_tools_active_video_generate'),
          )

  const headerStatus = generationError || isTerminalFailure ? 'error' : toolStatus

  const videoAriaLabel = t(
    'builder_tools_video_ai_generated_aria',
    undefined,
    defaultMessageForVideoToolKey('builder_tools_video_ai_generated_aria'),
  )

  return (
    <div>
      {shouldShowHeader && (
        <ToolHeader
          icon={<Video className="w-2 h-2" />}
          displayName={headerLabel}
          toolStatus={headerStatus}
          hasDetails={hasDetails}
          onOpenModal={hasDetails ? handleModalOpen : undefined}
        />
      )}

      {toolStatus === 'completed' && hasVideo && video && (
        <div className="my-2">
          <div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
            <Video className="w-3 h-3" />
            <span>
              {t(
                'builder_tools_video_generated_prompt',
                {
                  prompt: generationPrompt.length > 50
                    ? `${generationPrompt.substring(0, 50)}...`
                    : generationPrompt,
                },
                defaultMessageForVideoToolKey('builder_tools_video_generated_prompt'),
              )}
            </span>
          </div>
          <div className="rounded-lg overflow-hidden bg-intents-ux-boxLowContrast-backgroundColor relative group">
            <video
              ref={inlineVideoRef}
              src={playbackUrl}
              className="w-full aspect-video object-contain cursor-pointer"
              onClick={handleInlinePlayPause}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              playsInline
              preload="metadata"
              aria-label={videoAriaLabel}
            >
              <track kind="descriptions" label="Description" srcLang="en" default />
            </video>
            {!isPlaying && (
              <button
                onClick={handleInlinePlayPause}
                className="absolute inset-0 flex items-center justify-center bg-black/50 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-full bg-black/90 flex items-center justify-center shadow-lg">
                  <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
                </div>
              </button>
            )}
            <button
              onClick={handleModalOpen}
              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/90 flex items-center justify-center cursor-pointer shadow-lg"
              title="Open fullscreen"
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <MediaModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={t(
          'builder_tools_video_modal_title',
          undefined,
          defaultMessageForVideoToolKey('builder_tools_video_modal_title'),
        )}
      >
        {video && (
          <div className="flex flex-col items-center">
            <div className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg overflow-hidden w-full">
              <video
                ref={modalVideoRef}
                src={playbackUrl}
                className="w-full max-h-[70vh] object-contain"
                controls
                autoPlay
                playsInline
                aria-label={videoAriaLabel}
              >
                <track kind="descriptions" label="Description" srcLang="en" default />
              </video>
            </div>
          </div>
        )}
      </MediaModal>
    </div>
  )
}
