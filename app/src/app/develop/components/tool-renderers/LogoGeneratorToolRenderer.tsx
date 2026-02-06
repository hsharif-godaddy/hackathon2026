'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { logger } from '@/lib/request-context'

interface LogoResult {
  id: string
  url: string
  mockupUrl?: string
  logoFeatures?: {
    logoStyle?: string
    businessDescription?: string
    logoColors?: {
      description?: string
      hexValues?: string[]
    }
  }
  foregroundColor?: string
  backgroundColor?: string
  palette?: string[]
}

/**
 * Custom renderer for media__generate_logo tool
 *
 * Displays generated logos in a selectable grid format.
 * Users can click to select a logo, which opens a modal with larger view.
 */
export default function LogoGeneratorToolRenderer({
  toolName: _toolName,
  toolStatus,
  input: _input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedLogoIndex, setSelectedLogoIndex] = useState(0)
  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Parse result - expects the MCP response format
  const logos: LogoResult[] = []

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
        // Handle structuredContent from MCP response
        if (resultObj.structuredContent?.logos) {
          logos.push(...resultObj.structuredContent.logos)
        }
        // Handle direct logos array
        else if (resultObj.logos && Array.isArray(resultObj.logos)) {
          logos.push(...resultObj.logos)
        }
        // Handle content array with resources (MCP format)
        else if (resultObj.content && Array.isArray(resultObj.content)) {
          // Extract URLs from resource items
          const resourceItems = resultObj.content.filter(
            (item: any) => item.type === 'resource' && item.resource?.uri
          )
          resourceItems.forEach((item: any, index: number) => {
            logos.push({
              id: `logo-${index + 1}`,
              url: item.resource.uri
            })
          })
          // Also check structuredContent if available
          if (resultObj.structuredContent?.logos) {
            // Replace with richer data if available
            logos.length = 0
            logos.push(...resultObj.structuredContent.logos)
          }
        }
      }
    } catch (e) {
      logger.error('tool.logo_generator.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: typeof result === 'string' ? result.length : undefined
      })
    }
  }

  const logoCount = logos.length
  const hasLogos = logoCount > 0
  const hasDetails = hasLogos

  const handleLogoClick = (index: number) => {
    setSelectedLogoIndex(index)
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
  }

  // Keyboard navigation in modal
  useEffect(() => {
    if (!isModalOpen || logos.length <= 1) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setSelectedLogoIndex((prev) => (prev > 0 ? prev - 1 : logos.length - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setSelectedLogoIndex((prev) => (prev < logos.length - 1 ? prev + 1 : 0))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen, logos.length])

  // Scroll selected thumbnail into view
  useEffect(() => {
    if (isModalOpen && thumbnailRefs.current[selectedLogoIndex]) {
      thumbnailRefs.current[selectedLogoIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      })
    }
  }, [selectedLogoIndex, isModalOpen])

  const selectedLogo = logos[selectedLogoIndex]

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
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={handleModalClose}
          >
            <motion.div
              className="max-w-2xl w-full bg-intents-ux-box-backgroundColor rounded-lg shadow-xl relative max-h-[90vh] flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header - fixed */}
              <div className="p-4 pb-0 flex-shrink-0">
                {/* Close button */}
                <div className="absolute top-2 right-2 z-10">
                  <Button
                    onClick={handleModalClose}
                    icon={<XThickIcon className="h-3 w-3" />}
                    design="control"
                    aria-label="Close"
                    size="sm"
                  />
                </div>

                {/* Title */}
                <h2 className="text-xl font-bold mb-3">Generated Logos</h2>

                {/* Logo thumbnails navigation */}
                {logos.length > 1 && (
                  <div className="flex flex-nowrap gap-2 mb-3 overflow-x-auto pb-2 w-full">
                    {logos.map((logo, index) => (
                      <button
                        key={logo.id || index}
                        ref={(el) => { thumbnailRefs.current[index] = el }}
                        onClick={() => setSelectedLogoIndex(index)}
                        className={`flex-shrink-0 w-16 h-16 rounded-lg border-4 overflow-hidden transition-all hover:cursor-pointer hover:opacity-100 bg-intents-ux-boxLowContrast-backgroundColor ${
                          selectedLogoIndex === index ? 'border-primary ring-2 ring-primary/30' : 'border-border opacity-70'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={logo.url}
                          alt={`Logo ${index + 1}`}
                          className="w-full h-full object-contain"
                        />
                      </button>
                    ))}
                  </div>
                )}

                {/* Logo style header */}
                <div className="w-full text-center mb-3 pb-2 border-b border-border">
                  <h3 className="text-lg font-semibold">
                    {selectedLogo?.logoFeatures?.logoStyle
                      ? `${selectedLogo.logoFeatures.logoStyle} Style`
                      : `Logo ${selectedLogoIndex + 1}`}
                  </h3>
                  <p className="text-sm text-foreground/60 mt-0.5">
                    {selectedLogoIndex + 1} of {logos.length}
                  </p>
                </div>
              </div>

              {/* Scrollable content area */}
              <div className="p-4 pt-0 flex-1 overflow-y-auto">
                <div className="flex flex-col items-center">
                  {/* Color palette display - on top */}
                  {selectedLogo?.palette && selectedLogo.palette.length > 0 && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm text-foreground/70">Colors:</span>
                      <div className="flex gap-1">
                        {selectedLogo.palette.map((color, i) => (
                          <div
                            key={i}
                            className="w-6 h-6 rounded-full border border-border shadow-sm"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Logo and mockup side by side */}
                  <div className="w-full flex flex-col sm:flex-row gap-4 items-stretch justify-center">
                    {/* Main logo image */}
                    <div className="flex-1 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedLogo?.url}
                        alt={`Logo ${selectedLogoIndex + 1}`}
                        className="max-w-full max-h-[35vh] object-contain"
                      />
                    </div>

                    {/* Mockup preview if available */}
                    {selectedLogo?.mockupUrl && (
                      <div className="flex-1 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={selectedLogo.mockupUrl}
                          alt="Logo mockup"
                          className="max-w-full max-h-[35vh] object-contain rounded"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  // Only show header when not completed or no logos to display
  const shouldShowHeader = toolStatus !== 'completed' || !hasLogos

  return (
    <div>
      {shouldShowHeader && (
        <ToolHeader
          icon={<Sparkles className="w-2 h-2" />}
          displayName={toolStatus === 'completed' && hasLogos ? `Generated ${logoCount} logos` : 'Generating logos...'}
          toolStatus={toolStatus}
          hasDetails={hasDetails}
          onOpenModal={hasDetails ? () => setIsModalOpen(true) : undefined}
        />
      )}

      {/* Logo gallery grid */}
      {toolStatus === 'completed' && hasLogos && (
        <div className="my-2">
          <div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            <span>Generated {logoCount} logo{logoCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {logos.map((logo, index) => (
              <button
                key={logo.id || index}
                onClick={() => handleLogoClick(index)}
                className="aspect-square group cursor-pointer overflow-hidden rounded-lg border-2 border-border hover:border-primary transition-all bg-intents-ux-boxLowContrast-backgroundColor relative"
                title={logo.logoFeatures?.logoStyle ? `${logo.logoFeatures.logoStyle} Style` : `Logo ${index + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logo.url}
                  alt={`Logo ${index + 1}`}
                  className="w-full h-full object-contain p-1 opacity-90 group-hover:opacity-100 transition-all group-hover:scale-105"
                />
                {/* Style label */}
                {logo.logoFeatures?.logoStyle && (
                  <div className="absolute bottom-1 left-1 right-1">
                    <span className="text-xs px-1.5 py-0.5 rounded truncate block text-center bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
                      {logo.logoFeatures.logoStyle}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {modalContent && createPortal(modalContent, document.body)}
    </div>
  )
}
