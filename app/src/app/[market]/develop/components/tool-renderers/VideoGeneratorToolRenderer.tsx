'use client'

import { Play, Video } from 'lucide-react'
import { useRef, useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import MediaModal from '@/app/[market]/develop/components/tool-renderers/MediaModal'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { logger } from '@/lib/request-context'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'

interface VideoResult {
  url: string
  description?: string
}

/**
 * Custom renderer for media-video__generate_video tool
 *
 * Displays AI-generated video with inline player and modal for fullscreen view.
 */
export default function VideoGeneratorToolRenderer({
  toolName: _toolName,
  toolStatus,
  toolId,
  input: _input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)
  const [isPlaying, setIsPlaying] = useState(false)
  const inlineVideoRef = useRef<HTMLVideoElement>(null)
  const modalVideoRef = useRef<HTMLVideoElement>(null)

  // Parse result - expects the MCP response format
  let video: VideoResult | null = null

  // Parse input to get the generation prompt
  let generationPrompt = 'Video'
  if (_input) {
    try {
      const inputObj = typeof _input === 'string' ? JSON.parse(_input) : _input
      generationPrompt = inputObj?.prompt || 'Video'
    } catch {
      // Keep default
    }
  }

  if (result) {
    try {
      let resultObj: any = null

      if (typeof result === 'string') {
        try {
          resultObj = JSON.parse(result)
        } catch {
          // Not JSON string
        }
      } else if (typeof result === 'object') {
        resultObj = result
      }

      if (resultObj) {
        // Handle structuredContent.url from MCP response
        if (resultObj.structuredContent?.url) {
          video = {
            url: resultObj.structuredContent.url,
            description: undefined
          }
          // Try to find description from content array
          if (resultObj.content && Array.isArray(resultObj.content)) {
            const resourceItem = resultObj.content.find(
              (item: any) => item.type === 'resource_link' && item.uri
            )
            if (resourceItem?.description) {
              video.description = resourceItem.description
            }
          }
        }
        // Handle content array with resource_link items (MCP format)
        else if (resultObj.content && Array.isArray(resultObj.content)) {
          const resourceItem = resultObj.content.find(
            (item: any) => item.type === 'resource_link' && item.uri && item.mimeType?.startsWith('video/')
          )
          if (resourceItem) {
            video = {
              url: resourceItem.uri,
              description: resourceItem.description
            }
          }
        }
        // Handle direct url
        else if (resultObj.url) {
          video = {
            url: resultObj.url,
            description: resultObj.description
          }
        }
      }
    } catch (e) {
      logger.error('tool.video_generator.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: typeof result === 'string' ? result.length : undefined
      })
    }
  }

  const hasVideo = video !== null
  const hasDetails = hasVideo

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
      // Pause inline video when opening modal
      inlineVideoRef.current.pause()
      setIsPlaying(false)
    }
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    if (modalVideoRef.current) {
      // Pause modal video when closing
      modalVideoRef.current.pause()
    }
    setIsModalOpen(false)
  }

  // Only show header when not completed or no video to display
  const shouldShowHeader = toolStatus !== 'completed' || !hasVideo

  return (
    <div>
      {shouldShowHeader && (
        <ToolHeader
          icon={<Video className="w-2 h-2" />}
          displayName={toolStatus === 'completed' && hasVideo ? 'Generated video' : 'Generating video...'}
          toolStatus={toolStatus}
          hasDetails={hasDetails}
          onOpenModal={hasDetails ? handleModalOpen : undefined}
        />
      )}

      {/* Video player - inline display when completed */}
      {toolStatus === 'completed' && hasVideo && video && (
        <div className="my-2">
          <div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
            <Video className="w-3 h-3" />
            <span>Generated video: &quot;{generationPrompt.length > 50 ? generationPrompt.substring(0, 50) + '...' : generationPrompt}&quot;</span>
          </div>
          <div className="rounded-lg overflow-hidden bg-intents-ux-boxLowContrast-backgroundColor relative group">
            <video
              ref={inlineVideoRef}
              src={video.url}
              className="w-full aspect-video object-contain cursor-pointer"
              onClick={handleInlinePlayPause}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              aria-label={video.description || 'AI generated video'}
            >
              <track kind="descriptions" label="Description" srcLang="en" default />
            </video>
            {/* Play/Pause overlay */}
            {!isPlaying && (
              <button
                onClick={handleInlinePlayPause}
                className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors cursor-pointer"
              >
                <div className="w-16 h-16 rounded-full bg-intents-ux-boxHighContrast-backgroundColor flex items-center justify-center">
                  <Play className="w-8 h-8 text-intents-ux-boxHighContrast-foregroundColor ml-1" />
                </div>
              </button>
            )}
            {/* Expand button */}
            <button
              onClick={handleModalOpen}
              className="absolute top-2 right-2 p-2 rounded-lg bg-intents-ux-boxHighContrast-backgroundColor opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              title="Open fullscreen"
            >
              <svg className="w-4 h-4 text-intents-ux-boxHighContrast-foregroundColor" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>
          {/* Description below video */}
          {video.description && (
            <p className="text-sm text-foreground/60 mt-2 line-clamp-2">
              {video.description}
            </p>
          )}
        </div>
      )}

      <MediaModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title="AI Generated Video"
      >
        {video && (
          <div className="flex flex-col items-center">
            {/* Description */}
            {video.description && (
              <p className="text-sm text-foreground/70 mb-3 text-center max-w-2xl">
                {video.description}
              </p>
            )}

            {/* Video player */}
            <div className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg overflow-hidden w-full">
              <video
                ref={modalVideoRef}
                src={video.url}
                className="w-full max-h-[70vh] object-contain"
                controls
                autoPlay
                aria-label={video.description || 'AI generated video'}
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
