'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'

import { getDisplayColors } from '@/app/develop/components/utils/colorPaletteUtils'
import type { CompletePalette } from '@/app/develop/components/widgets/ColorPaletteGridWidget'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Color palette modal props
 */
export interface ColorPaletteModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  palettes?: Array<{ name: string; palette: CompletePalette }>
  palette?: CompletePalette | null
  showDetailsTab?: boolean
  detailsContent?: string
}

/**
 * Shared color palette modal component
 *
 * Displays color palette information in a modal with tabs for multiple palettes
 * or a single palette with optional details tab.
 *
 * @param props - Modal configuration
 * @returns Rendered modal component
 */
export default function ColorPaletteModal({
  isOpen,
  onClose,
  title,
  palettes,
  palette,
  showDetailsTab = false,
  detailsContent = ''
}: ColorPaletteModalProps) {
  const t = useTranslations();
  const [activeTab, setActiveTab] = useState<number | 'details'>(0)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  // Reset to first tab when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(0)
    }
  }, [isOpen])

  if (typeof document === 'undefined') {return null}

  // Determine which palette to display
  const displayPalette = palettes
    ? typeof activeTab === 'number' ? palettes[activeTab]?.palette : undefined
    : palette

  const hasPalette = displayPalette !== undefined && displayPalette !== null
  const displayColors = hasPalette ? getDisplayColors(displayPalette, t) : []

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-intents-ux-boxHighContrastOverlay-backgroundColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-2"
            onClick={onClose}
          >
            <motion.div
              className="max-w-2xl w-full bg-intents-ux-box-backgroundColor p-3 rounded-lg shadow-xl relative max-h-[80vh] flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-1.5 right-1.5">
                <Button
                  onClick={onClose}
                  icon={<XThickIcon className="h-3 w-3" />}
                  design="control"
                  aria-label={t('builder_common_close')}
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-2">{title}</h2>

              {/* Tabs */}
              {(palettes || showDetailsTab) && (
                <div className="flex gap-2 border-b mb-2 overflow-x-auto">
                  {palettes ? (
                    // Multiple palette tabs
                    palettes.map((paletteData, index) => (
                      <button
                        key={index}
                        onClick={() => setActiveTab(index)}
                        className={`pb-1 px-0.5 text-sm font-medium transition-colors whitespace-nowrap ${
                          activeTab === index
                            ? 'border-b-2'
                            : 'text-muted-foreground hover:text-foreground/70'
                        }`}
                      >
                        {paletteData.name}
                      </button>
                    ))
                  ) : showDetailsTab ? (
                    // Colors + Details tabs
                    <>
                      <button
                        onClick={() => setActiveTab(0)}
                        className={`pb-1 px-0.5 text-sm font-medium transition-colors ${
                          activeTab === 0
                            ? 'border-b-2'
                            : 'text-muted-foreground hover:text-foreground/70'
                        }`}
                      >
                        {t('builder_tools_color_palette_colors')}
                      </button>
                      <button
                        onClick={() => setActiveTab('details')}
                        className={`pb-1 px-0.5 text-sm font-medium transition-colors ${
                          activeTab === 'details'
                            ? 'border-b-2'
                            : 'text-muted-foreground hover:text-foreground/70'
                        }`}
                      >
                        {t('builder_tools_color_palette_details')}
                      </button>
                    </>
                  ) : null}
                </div>
              )}

              {/* Content area with scroll */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'details' ? (
                  /* Details tab */
                  <div className="prose prose-sm max-w-none">
                    <pre className="text-xs whitespace-pre-wrap p-2 rounded border">
                      {detailsContent}
                    </pre>
                  </div>
                ) : (
                  /* Color grid */
                  hasPalette && (
                    <div className="space-y-1.5">
                      {displayColors.map((color, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-2 p-1.5 rounded-lg border"
                          style={{ backgroundColor: `${color.background}15` }}
                        >
                          {/* Color swatch with foreground text */}
                          <div className="flex flex-col gap-1">
                            <div
                              className="w-12 h-12 rounded-md shadow-sm flex items-center justify-center text-sm font-mono font-semibold"
                              style={{
                                backgroundColor: color.background,
                                color: color.foreground
                              }}
                            >
                              {t('builder_tools_color_palette_aa')}
                            </div>
                          </div>

                          {/* Color info */}
                          <div className="flex-1">
                            <div className="font-semibold text-base">{color.name}</div>
                            <div className="text-sm text-muted-foreground font-mono mt-0.5">
                              {t('builder_tools_color_palette_background')}: {color.background}
                            </div>
                            <div className="text-sm text-muted-foreground font-mono">
                              {t('builder_tools_color_palette_foreground')}: {color.foreground}
                            </div>
                            {color.role && (
                              <div className="text-xs text-muted-foreground/70 mt-1">{color.role}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(modalContent, document.body)
}
