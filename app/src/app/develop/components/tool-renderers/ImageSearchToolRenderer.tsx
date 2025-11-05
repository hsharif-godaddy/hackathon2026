'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import MarkdownRenderer from '../MarkdownRenderer'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

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
  toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isModalOpen])

  const getStatusIndicator = () => {
    if (toolStatus === 'running') {
      return (
        <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )
    }
    return null
  }

  const statusIndicator = getStatusIndicator()

  // Parse result - can be JSON (new format) or Markdown (old format)
  let parsedResult: any = null
  const images: ImageResult[] = []
  let searchTerm = ''
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
          searchTerm = 'Image Search Results'
        }
      } else if (typeof result === 'object') {
        parsedResult = result
      }
      
      if (parsedResult) {
        // Handle single image result
        if (parsedResult.url) {
          const prompt = typeof parsedResult.prompt === 'string' ? parsedResult.prompt : 'Image'
          images.push({ prompt, url: parsedResult.url })
          searchTerm = prompt
        }
        // Handle multiple URLs for single prompt
        else if (parsedResult.urls && Array.isArray(parsedResult.urls)) {
          const prompt = typeof parsedResult.prompt === 'string' ? parsedResult.prompt : 'Image'
          searchTerm = prompt
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
          searchTerm = Array.isArray(parsedResult.prompt) ? parsedResult.prompt.join(', ') : 'Images'
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
                            selectedImageIndex === index ? 'border-blue-500' : 'border-gray-300'
                          }`}
                        >
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
                    <div className="text-sm font-semibold mb-2 text-gray-700">
                      {images[selectedImageIndex]?.prompt}
                    </div>
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

  return (
    <div className="-my-2">
      {/* Tool header */}
      <span className="text-gray-300 text-xs">
        <span className="text-gray-400">🖼️</span>
        {' '}
        {toolStatus === 'completed' && hasDetails ? (
          <button
            onClick={handleHeaderClick}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            {isMarkdownFormat && !hasImages ? (
              'Image Search'
            ) : (
              <>Found {imageCount} {imageCount === 1 ? 'image' : 'images'}</>
            )}
          </button>
        ) : (
          <span>
            Image Search
          </span>
        )}
        {statusIndicator && (
          <span className="inline-flex ml-1.5 text-gray-300">
            {statusIndicator}
          </span>
        )}
      </span>

      {/* Image gallery - always showing when completed */}
      {toolStatus === 'completed' && hasImages && (
        <div className="mt-3 mb-3">
          <div className="flex gap-3 overflow-x-auto pb-2 border rounded-lg p-3 bg-gray-50">
            {images.map((img, index) => (
              <button
                key={index}
                onClick={() => handleImageClick(index)}
                className="flex-shrink-0 group cursor-pointer"
                title={img.prompt}
              >
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

