'use client'

import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import MediaModal from '@/app/develop/components/tool-renderers/MediaModal'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { logger } from '@/lib/request-context'

interface ImageResult {
  url: string
  caption?: string
  width?: number
  height?: number
  contentType?: string
}

/**
 * Custom renderer for media__generate_image tool
 *
 * Displays AI-generated images in a grid format.
 * Users can click to select an image, which opens a modal with larger view.
 */
export default function ImageGeneratorToolRenderer({
  toolName: _toolName,
  toolStatus,
  input: _input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Parse result - expects the MCP response format
  const images: ImageResult[] = []

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
        // Handle structuredContent.images from MCP response
        if (resultObj.structuredContent?.images && Array.isArray(resultObj.structuredContent.images)) {
          resultObj.structuredContent.images.forEach((img: any) => {
            images.push({
              url: img.url,
              caption: img.caption,
              width: img.width,
              height: img.height,
              contentType: img.contentType
            })
          })
        }
        // Handle content array with resource_link items (MCP format)
        else if (resultObj.content && Array.isArray(resultObj.content)) {
          const resourceItems = resultObj.content.filter(
            (item: any) => item.type === 'resource_link' && item.uri
          )
          resourceItems.forEach((item: any) => {
            images.push({
              url: item.uri,
              caption: item.description
            })
          })
        }
        // Handle direct images array
        else if (resultObj.images && Array.isArray(resultObj.images)) {
          resultObj.images.forEach((img: any) => {
            images.push({
              url: img.url || img.uri,
              caption: img.caption || img.description,
              width: img.width,
              height: img.height,
              contentType: img.contentType
            })
          })
        }
      }
    } catch (e) {
      logger.error('tool.image_generator.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: typeof result === 'string' ? result.length : undefined
      })
    }
  }

  const imageCount = images.length
  const hasImages = imageCount > 0
  const hasDetails = hasImages

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index)
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
  }

  // Keyboard navigation in modal
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

  // Scroll selected thumbnail into view
  useEffect(() => {
    if (isModalOpen && thumbnailRefs.current[selectedImageIndex]) {
      thumbnailRefs.current[selectedImageIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      })
    }
  }, [selectedImageIndex, isModalOpen])

  const selectedImage = images[selectedImageIndex]

  // Only show header when not completed or no images to display
  const shouldShowHeader = toolStatus !== 'completed' || !hasImages

  return (
    <div>
      {shouldShowHeader && (
        <ToolHeader
          icon={<Sparkles className="w-2 h-2" />}
          displayName={toolStatus === 'completed' && hasImages ? `Generated ${imageCount} image${imageCount !== 1 ? 's' : ''}` : 'Generating images...'}
          toolStatus={toolStatus}
          hasDetails={hasDetails}
          onOpenModal={hasDetails ? () => setIsModalOpen(true) : undefined}
        />
      )}

      {/* Image gallery grid */}
      {toolStatus === 'completed' && hasImages && (
        <div className="my-2">
          <div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            <span>Generated {imageCount} image{imageCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {images.map((image, index) => (
              <button
                key={index}
                onClick={() => handleImageClick(index)}
                className="aspect-video group cursor-pointer overflow-hidden rounded-lg border-2 border-border hover:border-primary transition-all bg-intents-ux-boxLowContrast-backgroundColor relative"
                title={image.caption || `Image ${index + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.caption || `Image ${index + 1}`}
                  className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-all group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <MediaModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title="AI Generated Images"
      >
        {/* Image thumbnails navigation */}
        {images.length > 1 && (
          <div className="flex flex-nowrap gap-2 mb-3 overflow-x-auto pb-2 w-full">
            {images.map((image, index) => (
              <button
                key={index}
                ref={(el) => { thumbnailRefs.current[index] = el }}
                onClick={() => setSelectedImageIndex(index)}
                className={`flex-shrink-0 w-16 h-16 rounded-lg border-4 overflow-hidden transition-all hover:cursor-pointer hover:opacity-100 bg-intents-ux-boxLowContrast-backgroundColor ${
                  selectedImageIndex === index ? 'border-primary ring-2 ring-primary/30' : 'border-border opacity-70'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.caption || `Image ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {/* Image counter */}
        {images.length > 1 && (
          <div className="w-full text-center mb-3 pb-2 border-b border-border">
            <p className="text-sm text-foreground/60">
              {selectedImageIndex + 1} of {images.length}
            </p>
          </div>
        )}

        <div className="flex flex-col items-center">
          {/* Caption */}
          {selectedImage?.caption && (
            <p className="text-sm text-foreground/70 mb-3 text-center max-w-2xl">
              {selectedImage.caption}
            </p>
          )}

          {/* Main image */}
          <div className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedImage?.url}
              alt={selectedImage?.caption || `Image ${selectedImageIndex + 1}`}
              className="max-w-full max-h-[60vh] object-contain rounded"
            />
          </div>

          {/* Dimensions info */}
          {selectedImage?.width && selectedImage?.height && (
            <p className="text-xs text-foreground/50 mt-2">
              {selectedImage.width} x {selectedImage.height}
            </p>
          )}
        </div>
      </MediaModal>
    </div>
  )
}
