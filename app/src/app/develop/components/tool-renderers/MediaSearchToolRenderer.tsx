'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Image, Sparkles, SquarePlay } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'

import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'

interface ImageResult {
  prompt: string
  url: string
}

interface VideoResult {
  prompt: string
  url: string
}

/**
 * Custom renderer for mediaSearch tool
 *
 * Handles both image and video search results in a unified interface.
 * For images: Shows gallery with horizontal scrolling (200px height).
 * For videos: Shows single video player (paused by default).
 * Click to open modal with larger view for either type.
 */
export default function MediaSearchToolRenderer({
  toolName: _toolName,
  toolStatus,
  input: _input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const inlineVideoRef = useRef<HTMLVideoElement>(null)
  const modalVideoRef = useRef<HTMLVideoElement>(null)
  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Parse result - expects JSON format from mediaSearch tool
  let parsedResult: any = null
  const images: ImageResult[] = []
  let video: VideoResult | null = null
  let mediaType: 'image' | 'video' | 'generate' = 'image'
  let isMarkdownFormat = false
  let isGeneratedImage = false
  let markdownContent = ''

  if (result) {
    try {
      if (typeof result === 'string') {
        // Try to parse as JSON first
        try {
          parsedResult = JSON.parse(result)
          mediaType = parsedResult.mediaType || 'image'
          isGeneratedImage = mediaType === 'generate'
        } catch {
          // If JSON parse fails, it's the old markdown format (image only)
          isMarkdownFormat = true
          markdownContent = result
          mediaType = 'image'
          // Try to extract image URLs from markdown for inline display
          const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
          let match
          while ((match = imgRegex.exec(result)) !== null) {
            images.push({ prompt: match[1] || 'Image', url: match[2] })
          }
        }
      } else if (typeof result === 'object') {
        parsedResult = result
        mediaType = parsedResult.mediaType || 'image'
        isGeneratedImage = mediaType === 'generate'
      }

      if (parsedResult && (mediaType === 'image' || mediaType === 'generate')) {
        // Handle single image result (search or generation)
        if (parsedResult.url) {
          const prompt = typeof parsedResult.prompt === 'string' ? parsedResult.prompt : 'Image'
          images.push({ prompt, url: parsedResult.url })
        }
        // Handle multiple URLs for single prompt
        else if (parsedResult.urls && Array.isArray(parsedResult.urls)) {
          const prompt = typeof parsedResult.prompt === 'string' ? parsedResult.prompt : 'Image'
          parsedResult.urls.forEach((url: string) => {
            images.push({ prompt, url })
          })
        }
        // Handle multiple prompts with results
        else if (parsedResult.results && Array.isArray(parsedResult.results)) {
          parsedResult.results.forEach((r: any) => {
            if (r.success && r.url) {
              images.push({ prompt: r.prompt, url: r.url })
            } else if (r.success && r.urls && Array.isArray(r.urls)) {
              r.urls.forEach((url: string) => {
                images.push({ prompt: r.prompt, url })
              })
            }
          })
        }
      } else if (parsedResult && mediaType === 'video' && parsedResult.url) {
        const prompt = typeof parsedResult.prompt === 'string' ? parsedResult.prompt : 'Video'
        video = { prompt, url: parsedResult.url }
      }
    } catch (e) {
      logger.error('tool.media_search.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: result?.length
      })
    }
  }

  const imageCount = images.length
  const hasImages = imageCount > 0
  const hasVideo = video !== null
  const hasDetails = hasImages || hasVideo || isMarkdownFormat

  // Helper function to ensure URLs have proper protocol
  const ensureHttps = (url: string): string => {
    if (!url) return url
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    return `https://${url}`
  }

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index)
    setIsModalOpen(true)
  }

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
    if (hasVideo && inlineVideoRef.current) {
      // Pause inline video when opening modal
      inlineVideoRef.current.pause()
      setIsPlaying(false)
    }
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    if (hasVideo && modalVideoRef.current) {
      // Pause modal video when closing
      modalVideoRef.current.pause()
    }
    setIsModalOpen(false)
  }

  useEffect(() => {
    if (!isModalOpen || images.length <= 1) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setSelectedImageIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setSelectedImageIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen, images.length])

  useEffect(() => {
    if (isModalOpen && thumbnailRefs.current[selectedImageIndex]) {
      thumbnailRefs.current[selectedImageIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      })
    }
  }, [selectedImageIndex, isModalOpen])

  const modalContent = typeof document !== 'undefined' && (
    <AnimatePresence>
      {isModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-intents-ux-boxHighContrastOverlay-backgroundColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={handleModalClose}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-2"
            onClick={handleModalClose}
          >
            <motion.div
              className="max-w-5xl w-full bg-intents-ux-box-backgroundColor p-3 rounded-lg shadow-xl relative max-h-[90vh] flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-1.5 right-1.5">
                <Button
                  onClick={handleModalClose}
                  icon={<XThickIcon className="h-3 w-3" />}
                  design="control"
                  aria-label="Close"
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-2">
                {mediaType === 'video' ? t('builder_tools_media_video_result') : isGeneratedImage ? t('builder_tools_media_ai_result') : t('builder_tools_media_image_result')}
              </h2>

              {/* Markdown format (backwards compatibility - images only) */}
              {isMarkdownFormat && (
                <div className="flex-1 overflow-y-auto">
                  <MarkdownRenderer content={markdownContent} fullscreen={true} />
                </div>
              )}

              {/* Video display */}
              {!isMarkdownFormat && mediaType === 'video' && hasVideo && video && (
                <div className="flex-1 overflow-y-auto flex flex-col items-center">
                  <div className="relative max-w-full">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video
                      ref={modalVideoRef}
                      src={video.url}
                      className="max-w-full max-h-[70vh] rounded-lg shadow-lg"
                      controls
                    />
                  </div>
                </div>
              )}

              {/* Image display (for both searched and generated images) */}
              {!isMarkdownFormat && (mediaType === 'image' || mediaType === 'generate') && hasImages && (
                <>
                  {/* Image navigation */}
                  {images.length > 1 && (
                    <div className="flex flex-nowrap gap-1 mb-2 overflow-x-auto pb-1 w-full">
                      {images.map((img, index) => (
                        <button
                          key={index}
                          ref={(el) => { thumbnailRefs.current[index] = el }}
                          onClick={() => setSelectedImageIndex(index)}
                          className={`flex-shrink-0 w-10 h-10 rounded border-4 overflow-hidden transition-all hover:cursor-pointer hover:opacity-100 ${
                            selectedImageIndex === index ? 'border-primary' : 'border-border opacity-70'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={ensureHttps(img.url)}
                            alt={img.prompt}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Main image display */}
                  <div className="flex-1 overflow-y-auto flex flex-col items-center">
                    <div className="text-sm font-semibold italic mb-1 text-foreground/70">
                      {images[selectedImageIndex]?.prompt}
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ensureHttps(images[selectedImageIndex]?.url)}
                      alt={images[selectedImageIndex]?.prompt}
                      className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-lg"
                    />
                  </div>
                </>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  let displayName = 'Media'
  let icon = <Image className="w-2 h-2" /> /* eslint-disable-line jsx-a11y/alt-text */

  if (toolStatus === 'completed') {
    if (mediaType === 'video' && hasVideo) {
      displayName = t('builder_tools_media_found_video')
      icon = <SquarePlay className="w-2 h-2" />
    } else if (isGeneratedImage && hasImages) {
      displayName = t('builder_tools_media_ai_result')
      icon = <Sparkles className="w-2 h-2" />
    } else if (mediaType === 'image' && hasImages && !isMarkdownFormat) {
      displayName = t('builder_tools_imagesearch_found', { imageCount })
      icon = <Image className="w-2 h-2" /> /* eslint-disable-line jsx-a11y/alt-text */
    }
  }

  // Determine which images to show in the gallery
  const shouldShowSeeAll = imageCount > 4
  const displayedImages = shouldShowSeeAll ? images.slice(0, 3) : images

  // Only show header when not completed or no media to display
  const shouldShowHeader = toolStatus !== 'completed' || (!hasImages && !hasVideo)

  return (
    <div>
      {shouldShowHeader && (
        <ToolHeader
          icon={icon}
          displayName={displayName}
          toolStatus={toolStatus}
          hasDetails={hasDetails}
          onOpenModal={hasDetails ? handleModalOpen : undefined}
        />
      )}

      {/* Image gallery - showing for searched and generated images */}
      {toolStatus === 'completed' && (mediaType === 'image' || mediaType === 'generate') && hasImages && (!isMarkdownFormat || isGeneratedImage) && (
        <div className="my-2">
          <div className="grid grid-cols-4 gap-1.5">
            {displayedImages.map((img, index) => (
              <button
                key={index}
                onClick={() => handleImageClick(index)}
                className="aspect-square group cursor-pointer overflow-hidden rounded-md"
                title={img.prompt}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ensureHttps(img.url)}
                  alt={img.prompt}
                  className="w-full h-full object-cover opacity-90 hover:opacity-100 transition-all hover:scale-105"
                />
              </button>
            ))}
            {shouldShowSeeAll && (
              <button
                onClick={handleModalOpen}
                className="aspect-square cursor-pointer border border-dashed border-border overflow-hidden rounded-md bg-intents-ux-boxLowContrast-backgroundColor transition-all flex flex-col items-center justify-center"
              >
                <span className="text-md font-semibold">+{imageCount - 3}</span>
                <span className="text-sm">{t('builder_common_see_all')}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Video player - inline display when completed */}
      {toolStatus === 'completed' && mediaType === 'video' && hasVideo && video && (
        <div className="my-2">
          <div className="rounded-md">
            <div className="relative">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={inlineVideoRef}
                src={video.url}
                className="w-full object-contain rounded-md"
                onClick={handleInlinePlayPause}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            </div>
          </div>
        </div>
      )}

      {createPortal(modalContent, document.body)}
    </div>
  )
}
