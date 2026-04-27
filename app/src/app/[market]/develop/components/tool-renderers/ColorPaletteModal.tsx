'use client'

import { useEffect, useState } from 'react'
import Modal from '@ux/modal'

import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme'
import { getDisplayColors } from '@/app/[market]/develop/components/utils/colorPaletteUtils'
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

  // reset to first tab when reopening modal
  useEffect(() => {
    if (isOpen) {
      setActiveTab(0)
    }
  }, [isOpen])

  if (!isOpen) return null

  const displayPalette = palettes
    ? typeof activeTab === 'number' ? palettes[activeTab]?.palette : undefined
    : palette

  const hasPalette = displayPalette !== undefined && displayPalette !== null
  const displayColors = hasPalette ? getDisplayColors(displayPalette, t) : []

  return (
    <Modal title={title} onClose={onClose} portalElem={document.body}>
      <div className="w-full max-w-2xl flex flex-col max-h-[70vh]">
        {/* Tabs */}
        {(palettes || showDetailsTab) && (
          <div className="flex gap-2 border-b mb-2 overflow-x-auto">
            {palettes ? (
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
            <div className="prose prose-sm max-w-none">
              <pre className="text-xs whitespace-pre-wrap p-2 rounded border">
                {detailsContent}
              </pre>
            </div>
          ) : (
            hasPalette && (
              <div className="space-y-1.5">
                {displayColors.map((color, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-1.5 rounded-lg border"
                    style={{ backgroundColor: `${color.background}15` }}
                  >
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
      </div>
    </Modal>
  )
}
