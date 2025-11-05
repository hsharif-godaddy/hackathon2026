'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import ColorPaletteWidget from '../widgets/ColorPaletteWidget'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { getContrastColor } from '@/utils/color'

/**
 * Color info structure from cssColor tool result
 */
interface ColorInfo {
  name: string
  hex: string
  role?: string
}

/**
 * Custom renderer for cssColor tool
 * 
 * Shows "Color Scheme: {name} {mode}" on completion.
 * Auto-disappears 2 seconds after completion in generate-only mode.
 * Clickable to show larger format with labels and hex codes.
 * 
 * @param props - Tool call information
 * @returns Rendered cssColor tool component
 */
export default function CssColorToolRenderer({
  toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const [isVisible, setIsVisible] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'colors' | 'details'>('colors')

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

  // Extract palette name and mode from result or input
  const isGenerateOnly = input?.generateOnly === true
  
  // Get palette name from result (now always included) or fallback to input
  let paletteName = 'Color Scheme'
  if (result && typeof result === 'object') {
    const resultObj = result as any
    // Check for paletteName in result (applied mode)
    if (resultObj.paletteName) {
      paletteName = resultObj.paletteName
    }
    // Check for widget.name (generate mode)
    else if (resultObj.widget?.name) {
      paletteName = resultObj.widget.name
    }
    // Fallback to input
    else if (input?.paletteName) {
      paletteName = input.paletteName as string
    }
  } else if (input?.paletteName) {
    paletteName = input.paletteName as string
  }
  
  const mode = isGenerateOnly ? 'generated' : 'applied'

  // Auto-disappear effect for generate-only mode
  useEffect(() => {
    if (toolStatus === 'completed' && isGenerateOnly && result) {
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 2000)

      return () => clearTimeout(timer)
    }
  }, [toolStatus, isGenerateOnly, result])

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

  // Extract colors from result
  const colors: ColorInfo[] = []
  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const resultObj = result as any
    
    // Check for displayColors (applied mode)
    if (resultObj.displayColors && Array.isArray(resultObj.displayColors)) {
      colors.push(...resultObj.displayColors)
    }
    // Check for widget.colors (generate-only mode)
    else if (resultObj.widget?.colors && Array.isArray(resultObj.widget.colors)) {
      colors.push(...resultObj.widget.colors)
    }
    // Fallback to palette object
    else if (resultObj.palette) {
      const palette = resultObj.palette
      if (palette.primary) colors.push({ name: 'Primary', hex: palette.primary, role: 'Main brand color' })
      if (palette.secondary) colors.push({ name: 'Secondary', hex: palette.secondary, role: 'Supporting elements' })
      if (palette.accent) colors.push({ name: 'Accent', hex: palette.accent, role: 'Highlights' })
      if (palette.background) colors.push({ name: 'Background', hex: palette.background, role: 'Base layer' })
      if (palette.success) colors.push({ name: 'Success', hex: palette.success, role: 'Success states' })
    }
  }

  const hasColors = colors.length > 0
  const showDetailsTab = !isGenerateOnly && toolStatus === 'completed'

  // Get the full message output for details tab
  const fullMessage = result && typeof result === 'object' && (result as any).message
    ? (result as any).message
    : ''

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
              <h2 className="text-xl font-bold mb-4">{paletteName}</h2>

              {/* Tabs */}
              {showDetailsTab && (
                <div className="flex gap-4 border-b mb-4">
                  <button
                    onClick={() => setActiveTab('colors')}
                    className={`pb-2 px-1 text-sm font-medium transition-colors ${
                      activeTab === 'colors'
                        ? 'border-b-2 border-blue-500 text-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Colors
                  </button>
                  <button
                    onClick={() => setActiveTab('details')}
                    className={`pb-2 px-1 text-sm font-medium transition-colors ${
                      activeTab === 'details'
                        ? 'border-b-2 border-blue-500 text-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Details
                  </button>
                </div>
              )}

              {/* Content area with scroll */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'colors' ? (
                  /* Color grid */
                  <div className="space-y-3">
                    {colors.map((color, index) => (
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
                ) : (
                  /* Details tab */
                  <div className="prose prose-sm max-w-none">
                    <pre className="text-xs whitespace-pre-wrap bg-gray-50 p-4 rounded border">
                      {fullMessage}
                    </pre>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <div className="-my-2">
      <span className="text-gray-300 text-xs">
        <span className="text-gray-400">🎨</span>
        {' '}
        {toolStatus === 'completed' && hasColors ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            Color Scheme: {paletteName} {mode}
          </button>
        ) : (
          <span>
            Color Scheme
            {toolStatus === 'completed' && `: ${paletteName} ${mode}`}
          </span>
        )}
        {statusIndicator && (
          <span className="inline-flex ml-1.5 text-gray-300">
            {statusIndicator}
          </span>
        )}
      </span>

      {/* Display palette widget beneath when applied (not generate-only) */}
      {toolStatus === 'completed' && !isGenerateOnly && hasColors && (
        <div className="mt-4 mb-4">
          <ColorPaletteWidget
            name={paletteName}
            colors={colors}
          />
        </div>
      )}

      {mounted && createPortal(modalContent, document.body)}
    </div>
  )
}

