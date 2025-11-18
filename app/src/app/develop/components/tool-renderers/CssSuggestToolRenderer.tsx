'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import ColorPaletteGridWidget, { type PaletteData } from '../widgets/ColorPaletteGridWidget'
import ToolHeader from './ToolHeader'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { getContrastColor } from '@/utils/color'
import { Palette } from 'lucide-react'

/**
 * Custom renderer for cssSuggest tool
 *
 * Displays a grid of color palette suggestions that were generated.
 * Shows the palettes inline without needing to expand details.
 * Clickable to open modal with tabs for each palette option.
 */
export default function CssSuggestToolRenderer({
  toolName: _toolName,
  toolStatus,
  result
}: DefaultToolRendererProps) {
  const [isVisible] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState(0)

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

  if (!isVisible) {
    return null
  }


  // Extract palettes from result
  let palettes: PaletteData[] = []
  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const resultObj = result as any

    // Check for widget.widgetData.palettes structure
    if (resultObj.widget?.widgetData?.palettes && Array.isArray(resultObj.widget.widgetData.palettes)) {
      palettes = resultObj.widget.widgetData.palettes
    }
    // Fallback to direct palettes array
    else if (resultObj.palettes && Array.isArray(resultObj.palettes)) {
      palettes = resultObj.palettes
    }
  }

  const hasPalettes = palettes.length > 0

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
              className="max-w-2xl w-full bg-intents-ux-box-backgroundColor p-6 rounded-lg shadow-xl relative max-h-[80vh] flex flex-col"
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
              <h2 className="text-xl font-bold mb-4">Color Scheme Suggestions</h2>

              {/* Tabs for each palette */}
              <div className="flex gap-4 border-b mb-4 overflow-x-auto">
                {palettes.map((palette, index) => (
                  <button
                    key={index}
                    onClick={() => setActiveTab(index)}
                    className={`pb-2 px-1 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeTab === index
                        ? 'border-b-2 border-blue-500 text-blue-600'
                        : 'text-muted-foreground hover:text-foreground/70'
                    }`}
                  >
                    {palette.name}
                  </button>
                ))}
              </div>

              {/* Content area with scroll */}
              <div className="flex-1 overflow-y-auto">
                {/* Color grid for active palette */}
                <div className="space-y-3">
                  {palettes[activeTab]?.colors.map((color, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-4 p-3 rounded-lg border"
                      style={{ backgroundColor: `${color.hex}15` }}
                    >
                      {/* Color swatch with foreground text */}
                      <div className="flex flex-col gap-2">
                        <div
                          className="w-24 h-24 rounded-md shadow-sm flex items-center justify-center text-sm font-mono font-semibold"
                          style={{
                            backgroundColor: color.hex,
                            color: color.foreground || getContrastColor(color.hex)
                          }}
                        >
                          Aa Text
                        </div>
                        <div className="text-xs text-center text-muted-foreground">
                          Background
                        </div>
                      </div>

                      {/* Color info */}
                      <div className="flex-1">
                        <div className="font-semibold text-base">{color.name}</div>
                        <div className="text-sm text-muted-foreground font-mono mt-1">
                          Background: {color.hex}
                        </div>
                        {color.foreground && (
                          <div className="text-sm text-muted-foreground font-mono">
                            Foreground: {color.foreground}
                          </div>
                        )}
                        {color.role && (
                          <div className="text-xs text-muted-foreground/70 mt-2">{color.role}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  const displayName = (toolStatus === 'completed' && hasPalettes)
    ? `Color Scheme Suggestions (${palettes.length} options)`
    : 'Color Scheme Suggestions'

  return (
    <div>
      <ToolHeader
        icon={<Palette className="w-4 h-4" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasPalettes}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {/* Display palette grid when completed */}
      {toolStatus === 'completed' && hasPalettes && (
        <div className="mt-4 mb-4">
          <ColorPaletteGridWidget palettes={palettes} />
          
          {/* Helper message */}
          <div className="flex items-center gap-2 text-xs text-intents-ux-textSubtle-textColor mt-4">
            <svg 
              className="w-6 h-6" 
              fill="currentColor" 
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 3 .97 4.29L2 22l5.71-.97C9 21.64 10.46 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.38 0-2.68-.3-3.86-.83l-.28-.14-2.86.49.49-2.86-.14-.28A7.95 7.95 0 014 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8z"/>
              <path d="M7 9h10v2H7zm0 4h7v2H7z"/>
            </svg>
            <span className="text-sm">Select a color above to preview, or ask below for different options</span>
          </div>
        </div>
      )}

      {mounted && createPortal(modalContent, document.body)}
    </div>
  )
}
