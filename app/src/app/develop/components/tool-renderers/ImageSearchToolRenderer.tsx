'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import MarkdownRenderer from '../MarkdownRenderer'
import ToolHeader from './ToolHeader'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { Image } from 'lucide-react'

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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

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
            images.push({ prompt: match[1] || 'Image', url: match[2] })
          }
        }
      } else if (typeof result === 'object') {
        parsedResult = result
      }

      if (parsedResult) {
        // Handle single image result
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
      }
    } catch (e) {
      console.error('Failed to parse imageSearch result:', e)
    }
  }

  const imageCount = images.length
  const hasImages = imageCount > 0
  const hasDetails = hasImages || isMarkdownFormat

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index)
    setIsModalOpen(true)
  }

  const handleHeaderClick = () => {
    setIsModalOpen(true)
  }

  const modalContent = mounted && (
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
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              className="max-w-5xl w-full bg-intents-ux-box-backgroundColor p-6 rounded-lg shadow-xl relative max-h-[90vh] flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-3 right-3">
                <Button
                  onClick={() => setIsModalOpen(false)}
                  icon={<XThickIcon className="h-6 w-6" />}
                  design="control"
                  aria-label="Close"
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-4">Image Search Results</h2>

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
                    <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                      {images.map((img, index) => (
                        <button
                          key={index}
                          onClick={() => setSelectedImageIndex(index)}
                          className={`flex-shrink-0 w-20 h-20 rounded border-2 overflow-hidden ${
                            selectedImageIndex === index ? 'border-primary' : 'border-border'
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
                    <div className="text-sm font-semibold mb-2 text-foreground/70">
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
    ? `Found ${imageCount} ${imageCount === 1 ? 'image' : 'images'}`
    : 'Image Search'

  return (
    <div>
      <ToolHeader
        icon={<Image className="w-4 h-4" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={handleHeaderClick}
      />

      {/* Image gallery - always showing when completed */}
      {toolStatus === 'completed' && hasImages && (
        <div className="mt-3 mb-3">
          <div className="flex gap-3 overflow-x-auto pb-2 border border-border rounded-lg p-3 bg-muted">
            {images.map((img, index) => (
              <button
                key={index}
                onClick={() => handleImageClick(index)}
                className="flex-shrink-0 group cursor-pointer"
                title={img.prompt}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.prompt}
                  className="h-[200px] w-auto object-cover rounded-lg shadow-md hover:shadow-xl transition-shadow duration-200"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {mounted && createPortal(modalContent, document.body)}
    </div>
  )
}
