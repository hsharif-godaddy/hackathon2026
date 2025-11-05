'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import ColorPaletteGridWidget, { type PaletteData } from '../widgets/ColorPaletteGridWidget'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { getContrastColor } from '@/utils/color'

/**
 * Color info structure
 */
interface ColorInfo {
  name: string
  hex: string
  role?: string
}

/**
 * Custom renderer for cssSuggest tool
 * 
 * Displays a grid of color palette suggestions that were generated.
 * Shows the palettes inline without needing to expand details.
 * Clickable to open modal with tabs for each palette option.
 */
export default function CssSuggestToolRenderer({
  toolName,
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
                        : 'text-gray-500 hover:text-gray-700'
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
                      {/* Color swatch */}
                      <div
                        className="w-16 h-16 rounded-md shadow-sm flex items-center justify-center text-xs font-mono"
                        style={{
                          backgroundColor: color.hex,
                          color: getContrastColor(color.hex)
                        }}
                      >
                        Aa
                      </div>

                      {/* Color info */}
                      <div className="flex-1">
                        <div className="font-semibold text-base">{color.name}</div>
                        <div className="text-sm text-gray-600 font-mono">{color.hex}</div>
                        {color.role && (
                          <div className="text-xs text-gray-500 mt-1">{color.role}</div>
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

  return (
    <div className="-my-2">
      {/* Tool header */}
      <span className="text-gray-300 text-xs">
        <span className="text-gray-400">🎨</span>
        {' '}
        {toolStatus === 'completed' && hasPalettes ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            Color Scheme Suggestions ({palettes.length} options)
          </button>
        ) : (
          <span>
            Color Scheme Suggestions
            {toolStatus === 'completed' && hasPalettes && ` (${palettes.length} options)`}
          </span>
        )}
        {statusIndicator && (
          <span className="inline-flex ml-1.5 text-gray-300">
            {statusIndicator}
          </span>
        )}
      </span>

      {/* Display palette grid when completed */}
      {toolStatus === 'completed' && hasPalettes && (
        <div className="mt-4 mb-4">
          <ColorPaletteGridWidget palettes={palettes} />
        </div>
      )}

      {mounted && createPortal(modalContent, document.body)}
    </div>
  )
}

