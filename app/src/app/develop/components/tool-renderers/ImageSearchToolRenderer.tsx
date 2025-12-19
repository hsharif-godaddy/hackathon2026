'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Image } from 'lucide-react'
import { useState } from 'react'
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

/**
 * Custom renderer for imageSearch tool
 *
 * Shows "Found X images" on one line.
 * Displays horizontal scrolling gallery of images (200px height).
 * Click to open modal with larger view.
 */
export default function ImageSearchToolRenderer({
  toolName: _toolName,
  toolStatus,
  input: _input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)

  // Parse result - can be JSON (new format) or Markdown (old format)
  let parsedResult: any = null
  const images: ImageResult[] = []
  let isMarkdownFormat = false
  let markdownContent = ''

  if (result) {
    try {
      if (typeof result === 'string') {
        // Try to parse as JSON first
        try {
          parsedResult = JSON.parse(result)
        } catch {
          // If JSON parse fails, it's the old markdown format
          isMarkdownFormat = true
          markdownContent = result
          // Try to extract image URLs from markdown for inline display
          const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
          let match
          while ((match = imgRegex.exec(result)) !== null) {
            images.push({ prompt: match[1] || t('builder_common_image'), url: match[2] })
          }
        }
      } else if (typeof result === 'object') {
        parsedResult = result
      }

      if (parsedResult) {
        // Handle single image result
        if (parsedResult.url) {
          const prompt = typeof parsedResult.prompt === 'string' ? parsedResult.prompt : t('builder_common_image')
          images.push({ prompt, url: parsedResult.url })
        }
        // Handle multiple URLs for single prompt
        else if (parsedResult.urls && Array.isArray(parsedResult.urls)) {
          const prompt = typeof parsedResult.prompt === 'string' ? parsedResult.prompt : t('builder_common_image')
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
      }
    } catch (e) {
      logger.error('tool.image_search.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: result?.length
      })
    }
  }

  const imageCount = images.length
  const hasImages = imageCount > 0
  const hasDetails = hasImages || isMarkdownFormat

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index)
    setIsModalOpen(true)
  }

  const handleOpenModal = () => {
    setIsModalOpen(true)
  }

  // Determine which images to show in the gallery
  const shouldShowSeeAll = imageCount > 4
  const displayedImages = shouldShowSeeAll ? images.slice(0, 3) : images

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
            onClick={() => setIsModalOpen(false)}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-2"
            onClick={() => setIsModalOpen(false)}
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
                  onClick={() => setIsModalOpen(false)}
                  icon={<XThickIcon className="h-3 w-3" />}
                  design="control"
                  aria-label={t('builder_common_close')}
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-2">{t('builder_tools_imagesearch_title')}</h2>

              {/* Markdown format (backwards compatibility) */}
              {isMarkdownFormat && (
                <div className="flex-1 overflow-y-auto">
                  <MarkdownRenderer content={markdownContent} fullscreen={true} />
                </div>
              )}

              {/* JSON format (new) */}
              {!isMarkdownFormat && (
                <>
                  {/* Image navigation */}
                  {images.length > 1 && (
                    <div className="flex gap-1 mb-2 overflow-x-scroll pb-1 w-full max-w-full">
                      {images.map((img, index) => (
                        <button
                          key={index}
                          onClick={() => setSelectedImageIndex(index)}
                          className={`flex-shrink-0 w-10 h-10 rounded border-4 overflow-hidden transition-all hover:cursor-pointer hover:opacity-100 ${
                            selectedImageIndex === index ? 'border-primary' : 'border-border opacity-70'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.url}
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
                      src={images[selectedImageIndex]?.url}
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

  const displayName = (toolStatus === 'completed' && hasImages && !isMarkdownFormat)
    ? t('builder_tools_imagesearch_found', { imageCount })
    : t('builder_tools_imagesearch_title_only')

  return (
    <div>
      <ToolHeader
        icon={<Image className="w-2 h-2" />} /* eslint-disable-line jsx-a11y/alt-text */
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={handleOpenModal}
      />

      {/* Image gallery - always showing when completed */}
      {toolStatus === 'completed' && hasImages && (
        <div className="my-2">
          <div className="grid grid-cols-2 gap-1.5">
            {displayedImages.map((img, index) => (
              <button
                key={index}
                onClick={() => handleImageClick(index)}
                className="aspect-square group cursor-pointer overflow-hidden rounded-md"
                title={img.prompt}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.prompt}
                  className="w-full h-full object-cover opacity-90 hover:opacity-100 transition-all hover:scale-105"
                />
              </button>
            ))}
            {shouldShowSeeAll && (
              <button
                onClick={handleOpenModal}
                className="aspect-square cursor-pointer border border-dashed border-border overflow-hidden rounded-md bg-intents-ux-boxLowContrast-backgroundColor transition-all flex flex-col items-center justify-center"
              >
                <span className="text-md font-semibold">+{imageCount - 3}</span>
                <span className="text-sm">{t('builder_common_see_all')}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {createPortal(modalContent, document.body)}
    </div>
  )
}
