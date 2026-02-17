'use client'

import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import MediaModal from '@/app/develop/components/tool-renderers/MediaModal'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import LogoGridWidget, { type LogoData } from '@/app/develop/components/widgets/LogoGridWidget'
import { logger } from '@/lib/request-context'

type LogoResult = LogoData

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

  // Parse input to get business name for display
  let businessName = 'Logo'
  if (_input) {
    try {
      const inputObj = typeof _input === 'string' ? JSON.parse(_input) : _input
      businessName = inputObj?.businessName || 'Logo'
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

  // Build display name based on state
  const displayName = toolStatus === 'completed' && hasLogos
    ? `Generated ${logoCount} logo${logoCount !== 1 ? 's' : ''} for "${businessName}"`
    : 'Generating logos...'

  return (
    <div>
      <ToolHeader
        icon={<Sparkles className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={hasDetails ? () => setIsModalOpen(true) : undefined}
      />

      {/* Logo selection grid with action buttons */}
      {toolStatus === 'completed' && hasLogos && (
        <div className="mt-2 mb-2">
          <LogoGridWidget logos={logos} />
        </div>
      )}

      <MediaModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title="Generated Logos"
        maxWidth="max-w-2xl"
      >
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

        {/* Logo counter */}
        {logos.length > 1 && (
          <div className="w-full text-center mb-3 pb-2 border-b border-border">
            <p className="text-sm text-foreground/60">
              {selectedLogoIndex + 1} of {logos.length}
            </p>
          </div>
        )}

        <div className="flex flex-col items-center">
          {/* Color palette display */}
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

          {/* Main logo image */}
          <div className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedLogo?.url}
              alt={`Logo ${selectedLogoIndex + 1}`}
              className="max-w-full max-h-[50vh] object-contain"
            />
          </div>

          {/* Mockup preview if available */}
          {selectedLogo?.mockupUrl && (
            <div className="mt-4 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedLogo.mockupUrl}
                alt="Logo mockup"
                className="max-w-full max-h-[30vh] object-contain rounded"
              />
            </div>
          )}
        </div>
      </MediaModal>
    </div>
  )
}
